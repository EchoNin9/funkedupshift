"""
DynamoDB access for the social scheduling module (phase 2).

Single table (fus-social-posts, see infra/social.tf aws_dynamodb_table.socialPosts):

    Parent item   PK=POST#{postId}  SK=META
    Target item   PK=POST#{postId}  SK=TARGET#{platform}#{accountId}   (one per fan-out account)

GSIs:
    byStatusTime  PK=statusKey  SK=scheduledAt   -- sparse: only parent items while status == "pending"
    byMonth       PK=monthKey   SK=scheduledAt   -- parent items only (phase-4 calendar)

Uses the boto3 *resource* Table API (auto value marshalling) rather than the
low-level client + AttributeValue dicts used by tools/handler.py -- this
item shape has nested lists/dicts (mediaKeys, links, overrides) that would be
significantly more error-prone to hand-marshal as {"L": [...]}/{"M": {...}}.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SOCIAL_TABLE = os.environ.get("SOCIAL_TABLE", "")

STATUS_PENDING = "pending"
STATUS_PUBLISHING = "publishing"
STATUS_PUBLISHED = "published"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_PARTIAL = "partial"  # parent-only rollup status; never a target status

TARGET_TERMINAL_STATUSES = {STATUS_PUBLISHED, STATUS_FAILED, STATUS_CANCELLED}

_dynamodb = None
_table = None


class PostAlreadyExistsError(Exception):
    """Raised by createPost when postId collides with an existing item."""


def _resource():
    global _dynamodb
    if _dynamodb is None:
        import boto3
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb


def _tbl():
    """Cached Table resource. A module-level function (not a constant) so
    tests can `patch.object(storage, "_tbl", return_value=MagicMock())`,
    matching the `_ddb()`/`_kvsClient()` convention in tools/handler.py."""
    global _table
    if _table is None:
        _table = _resource().Table(SOCIAL_TABLE)
    return _table


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _deriveMonthKey(scheduledAt):
    """YYYY-MM derived from the UTC calendar date of scheduledAt -- deliberately
    NOT a naive string slice, since a scheduledAt carrying a non-UTC offset can
    fall on a different UTC calendar date (and thus a different month) than a
    naive slice of the literal string would suggest."""
    s = scheduledAt.replace("Z", "+00:00") if scheduledAt.endswith("Z") else scheduledAt
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m")


def _targetSk(platform, accountId):
    return f"TARGET#{platform}#{accountId}"


def _parentKey(postId):
    return {"PK": f"POST#{postId}", "SK": "META"}


def _targetKey(postId, platform, accountId):
    return {"PK": f"POST#{postId}", "SK": _targetSk(platform, accountId)}


# --- writes -------------------------------------------------------------------


def createPost(postId, text, mediaKeys, links, scheduledAt, createdBy, targets, scheduleName=None):
    """Write the parent META item plus one TARGET item per fan-out account.

    `targets` is a list of {"platform": str, "accountId": str, "overrides": dict}.
    Conditional on the parent PK not already existing -> PostAlreadyExistsError
    on a postId collision. Not written as a single DynamoDB transaction (the
    fan-out target puts happen after the conditional parent put succeeds) --
    acceptable because the maintenance sweep can repair a partial write the
    same way it repairs an orphaned schedule.
    """
    now = _isoNowUtc()
    monthKey = _deriveMonthKey(scheduledAt)
    parent = {
        "PK": f"POST#{postId}",
        "SK": "META",
        "entityType": "socialPost",
        "postId": postId,
        "text": text or "",
        "mediaKeys": list(mediaKeys or []),
        "links": list(links or []),
        "scheduledAt": scheduledAt,
        "status": STATUS_PENDING,
        "statusKey": f"STATUS#{STATUS_PENDING}",
        "monthKey": monthKey,
        "createdAt": now,
        "updatedAt": now,
        "createdBy": createdBy or "",
        "scheduleName": scheduleName or "",
    }

    table = _tbl()
    try:
        table.put_item(Item=parent, ConditionExpression="attribute_not_exists(PK)")
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise PostAlreadyExistsError(f"postId already exists: {postId}") from e
        raise

    for t in targets or []:
        targetItem = {
            "PK": f"POST#{postId}",
            "SK": _targetSk(t["platform"], t["accountId"]),
            "entityType": "socialTarget",
            "postId": postId,
            "platform": t["platform"],
            "accountId": t["accountId"],
            "status": STATUS_PENDING,
            "attemptCount": 0,
            "lastError": "",
            "permalink": "",
            "platformPostId": "",
            "overrides": t.get("overrides") or {},
            "updatedAt": now,
        }
        table.put_item(Item=targetItem)

    return getPost(postId)


def getPost(postId):
    """Returns {"parent": {...} | None, "targets": [...]}."""
    table = _tbl()
    resp = table.query(KeyConditionExpression=Key("PK").eq(f"POST#{postId}"))
    items = resp.get("Items", [])
    parent = None
    targets = []
    for item in items:
        if item.get("SK") == "META":
            parent = item
        else:
            targets.append(item)
    return {"parent": parent, "targets": targets}


def listPostsByMonth(monthKey):
    """Parent items scheduled in the given YYYY-MM month, via the byMonth GSI."""
    table = _tbl()
    resp = table.query(
        IndexName="byMonth",
        KeyConditionExpression=Key("monthKey").eq(monthKey),
    )
    return resp.get("Items", [])


def findOverduePending(nowIso, graceMinutes=15):
    """Parent posts still 'pending' (statusKey present -> sparse index) whose
    scheduledAt is more than graceMinutes in the past -- these are orphans:
    the one-shot EventBridge schedule never fired (or was lost)."""
    s = nowIso.replace("Z", "+00:00") if nowIso.endswith("Z") else nowIso
    now = datetime.fromisoformat(s)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = (now - timedelta(minutes=graceMinutes)).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    table = _tbl()
    resp = table.query(
        IndexName="byStatusTime",
        KeyConditionExpression=Key("statusKey").eq(f"STATUS#{STATUS_PENDING}") & Key("scheduledAt").lt(cutoff),
    )
    return resp.get("Items", [])


def updateParentStatus(postId, status):
    """Set the parent's status. statusKey is SET only while status == pending
    (keeps the sparse byStatusTime GSI tiny) and REMOVED for every other
    status so the item drops out of that index once it's no longer awaiting
    its first publish attempt."""
    table = _tbl()
    now = _isoNowUtc()
    if status == STATUS_PENDING:
        table.update_item(
            Key=_parentKey(postId),
            UpdateExpression="SET #s = :s, statusKey = :sk, updatedAt = :u",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":sk": f"STATUS#{status}", ":u": now},
        )
    else:
        table.update_item(
            Key=_parentKey(postId),
            UpdateExpression="SET #s = :s, updatedAt = :u REMOVE statusKey",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": status, ":u": now},
        )


def deriveParentStatus(targetStatuses):
    """Single place the parent-status rollup rule lives:
      - all targets published                -> published
      - all targets terminal, none published  -> failed
      - all targets terminal, a mix           -> partial
      - anything still pending/publishing     -> publishing (in progress)
    """
    if not targetStatuses:
        return STATUS_PENDING
    if any(s not in TARGET_TERMINAL_STATUSES for s in targetStatuses):
        return STATUS_PUBLISHING
    if all(s == STATUS_PUBLISHED for s in targetStatuses):
        return STATUS_PUBLISHED
    if all(s in (STATUS_FAILED, STATUS_CANCELLED) for s in targetStatuses):
        return STATUS_FAILED
    return STATUS_PARTIAL


def rollupParentStatus(postId):
    """Recompute and persist the parent's status from its targets' current
    statuses. Returns the derived status."""
    post = getPost(postId)
    statuses = [t["status"] for t in post["targets"]]
    derived = deriveParentStatus(statuses)
    updateParentStatus(postId, derived)
    return derived


def updateTargetStatus(postId, platform, accountId, status, expectedNotStatus=None, **fields):
    """Set a target's status (+ any of lastError/permalink/platformPostId).
    When `expectedNotStatus` is given, the write is conditional on the
    target's current status NOT equal to it (idempotency guard against a
    double-publish race between a live schedule and the reconciliation
    sweep) -- returns False (no exception) if that condition fails, True on
    success.
    """
    table = _tbl()
    now = _isoNowUtc()

    names = {"#s": "status"}
    values = {":s": status, ":u": now}
    setParts = ["#s = :s", "updatedAt = :u"]
    for key in ("lastError", "permalink", "platformPostId"):
        if key in fields:
            names[f"#{key}"] = key
            values[f":{key}"] = fields[key]
            setParts.append(f"#{key} = :{key}")

    kwargs = {
        "Key": _targetKey(postId, platform, accountId),
        "UpdateExpression": "SET " + ", ".join(setParts),
        "ExpressionAttributeNames": names,
        "ExpressionAttributeValues": values,
    }
    if expectedNotStatus is not None:
        kwargs["ConditionExpression"] = Attr("status").ne(expectedNotStatus)

    try:
        table.update_item(**kwargs)
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def incrementAttempt(postId, platform, accountId):
    """ADD attemptCount 1; returns the new count."""
    table = _tbl()
    resp = table.update_item(
        Key=_targetKey(postId, platform, accountId),
        UpdateExpression="ADD attemptCount :one SET updatedAt = :u",
        ExpressionAttributeValues={":one": 1, ":u": _isoNowUtc()},
        ReturnValues="UPDATED_NEW",
    )
    return int(resp.get("Attributes", {}).get("attemptCount", 0))


def cancelPost(postId):
    """Mark the parent cancelled and any still-pending target cancelled too.
    Targets that already reached a terminal state (published/failed) are left
    alone -- cancel stops further attempts, it does not erase history."""
    post = getPost(postId)
    if post["parent"] is None:
        return None
    for t in post["targets"]:
        if t["status"] == STATUS_PENDING:
            updateTargetStatus(postId, t["platform"], t["accountId"], STATUS_CANCELLED)
    updateParentStatus(postId, STATUS_CANCELLED)
    return getPost(postId)


def countHeartbeat(publishedSinceIso):
    """Scan-based counts for the daily heartbeat: pending posts, posts
    published since `publishedSinceIso`, and failed/partial posts. A full
    Scan is acceptable here -- this runs once a day off a low-volume table,
    and adding a third GSI purely for an operational heartbeat is not worth
    the extra write-side bookkeeping."""
    table = _tbl()
    pending = 0
    publishedRecent = 0
    failed = 0

    kwargs = {"FilterExpression": Attr("SK").eq("META")}
    while True:
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            status = item.get("status")
            if status == STATUS_PENDING:
                pending += 1
            elif status in (STATUS_FAILED, STATUS_PARTIAL):
                failed += 1
            elif status == STATUS_PUBLISHED and item.get("updatedAt", "") >= publishedSinceIso:
                publishedRecent += 1
        lastKey = resp.get("LastEvaluatedKey")
        if not lastKey:
            break
        kwargs["ExclusiveStartKey"] = lastKey

    return {"pending": pending, "publishedLast24h": publishedRecent, "failed": failed}
