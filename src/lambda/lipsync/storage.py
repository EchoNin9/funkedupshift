"""
DynamoDB access for the lipsync module.

One item per job (fus-lipsync-jobs, see infra/lipsync.tf
aws_dynamodb_table.lipsyncJobs):

    PK = JOB#{jobId}   SK = META

GSIs:
    byStatusTime  PK=statusKey  SK=updatedAt  -- sparse: only while status is
        non-terminal (queued/submitting/processing), see transitionStatus.
        Powers the reconciliation sweep (maintenance.findStuckJobs).
    byCreator     PK=createdBy SK=createdAt  -- reserved for a future
        per-creator list view / quota counter (see docs/lipsync-design.md);
        listJobs() below does not query it today, see that function's
        docstring for why.

Uses the boto3 resource Table API (auto value marshalling), same as
social/storage.py.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

LIPSYNC_TABLE = os.environ.get("LIPSYNC_TABLE", "")

MODE_AVATAR = "avatar"
MODE_RELIP = "relip"
MODES = {MODE_AVATAR, MODE_RELIP}

STATUS_QUEUED = "queued"
STATUS_SUBMITTING = "submitting"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

# docs/lipsync-design.md's state machine:
#   queued -> submitting -> processing -> completed
#      \          \              \----------> failed
#       \          \--------------------------> failed
#        \------------------------------------> failed
#   (any non-terminal) -> cancelled
NON_TERMINAL_STATUSES = {STATUS_QUEUED, STATUS_SUBMITTING, STATUS_PROCESSING}
TERMINAL_STATUSES = {STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED}
ALL_STATUSES = NON_TERMINAL_STATUSES | TERMINAL_STATUSES

DEFAULT_TTL_DAYS = 90
DEFAULT_LIST_LIMIT = 25
MAX_LIST_LIMIT = 100

_dynamodb = None
_table = None


class JobAlreadyExistsError(Exception):
    """Raised by createJob when jobId collides with an existing item. Should
    never happen in practice (jobId is a uuid4 hex) -- the conditional write
    is cheap insurance, same precedent as social.storage.PostAlreadyExistsError."""


def _resource():
    global _dynamodb
    if _dynamodb is None:
        import boto3
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb


def _tbl():
    """Cached Table resource. A module-level function (not a constant) so
    tests can `patch.object(storage, "_tbl", return_value=MagicMock())`,
    matching social/storage.py's identical convention."""
    global _table
    if _table is None:
        _table = _resource().Table(LIPSYNC_TABLE)
    return _table


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _epochSecondsInDays(days):
    return int((datetime.now(timezone.utc) + timedelta(days=days)).timestamp())


def _jobKey(jobId):
    return {"PK": f"JOB#{jobId}", "SK": "META"}


def _statusKeyFor(status):
    """None for a terminal status (statusKey is REMOVED, not set to some
    'STATUS#completed' value -- see transitionStatus)."""
    return None if status in TERMINAL_STATUSES else f"STATUS#{status}"


# --- writes --------------------------------------------------------------------


def createJob(jobId, mode, provider, model, audioKey, createdBy, consentAttested,
              imageKey="", videoKey="", prompt="", reservedCents=0,
              ttlDays=DEFAULT_TTL_DAYS):
    now = _isoNowUtc()
    item = {
        "PK": f"JOB#{jobId}",
        "SK": "META",
        "entityType": "lipsyncJob",
        "jobId": jobId,
        "mode": mode,
        "status": STATUS_QUEUED,
        "statusKey": _statusKeyFor(STATUS_QUEUED),
        "provider": provider,
        "model": model or "",
        "createdBy": createdBy or "",
        "createdAt": now,
        "updatedAt": now,
        "imageKey": imageKey or "",
        "videoKey": videoKey or "",
        "audioKey": audioKey or "",
        "prompt": prompt or "",
        "outputKey": "",
        "providerJobId": "",
        "checkCount": 0,
        "expiresAt": _epochSecondsInDays(ttlDays),
        "consentAttested": bool(consentAttested),
        # Budget hold placed by routes.createJob BEFORE this write. Carried on
        # the job so the runner knows how much to settle or release without
        # re-deriving it, and so `budgetSettled` can make that a one-time
        # transition (a replayed runner invocation must not charge twice).
        "reservedCents": Decimal(int(reservedCents)),
        "budgetSettled": False,
        "error": "",
    }
    table = _tbl()
    try:
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            raise JobAlreadyExistsError(f"jobId already exists: {jobId}") from e
        raise
    return item


def getJob(jobId):
    table = _tbl()
    resp = table.get_item(Key=_jobKey(jobId))
    return resp.get("Item")


def transitionStatus(jobId, fromStatus, toStatus, **fields):
    """Conditional write: succeeds only if the job's CURRENT status equals
    `fromStatus` exactly. Returns True on success, False if the condition
    failed -- e.g. a duplicate scheduler firing, a race with cancellation,
    or the job doesn't exist -- and NEVER raises for that expected case, so
    callers treat "someone else already moved this job" as a normal, silent
    no-op. This single primitive is the mechanism behind both "a duplicate
    scheduler firing must not double-submit" (a second submitJob's
    queued->submitting conditional write loses the race) and "cancel wins,
    no resurrection" (any in-flight checkJob write is conditioned on the
    job still being `processing`, so it silently fails once cancelJob has
    already moved the status to `cancelled`).

    statusKey is SET to STATUS#{toStatus} while toStatus is non-terminal,
    and REMOVED on a terminal transition -- same sparse-GSI trick as
    social/storage.py's updateParentStatus. `fields` may include any other
    attribute to set in the same write (providerJobId, checkCount,
    outputKey, durationSec, error, ...); every key is aliased via
    ExpressionAttributeNames so none can collide with a DynamoDB reserved
    word, same defensive convention social/storage.py uses. Any `float`
    value (durationSec, from media.probeDurationSeconds) is converted to
    Decimal here -- boto3's Table resource raises
    "Float types are not supported" on a raw float, and a fully-mocked
    `table` in a unit test would never catch that (the mock never touches
    boto3's real serializer), so this conversion belongs at the one choke
    point every write goes through, not scattered at each call site.
    """
    now = _isoNowUtc()
    names = {"#s": "status"}
    values = {":s": toStatus, ":u": now}
    setParts = ["#s = :s", "updatedAt = :u"]
    removeParts = []

    newStatusKey = _statusKeyFor(toStatus)
    if newStatusKey is not None:
        values[":sk"] = newStatusKey
        setParts.append("statusKey = :sk")
    else:
        removeParts.append("statusKey")

    for key, value in fields.items():
        if isinstance(value, float):
            value = Decimal(str(value))
        names[f"#{key}"] = key
        values[f":{key}"] = value
        setParts.append(f"#{key} = :{key}")

    updateExpr = "SET " + ", ".join(setParts)
    if removeParts:
        updateExpr += " REMOVE " + ", ".join(removeParts)

    table = _tbl()
    try:
        table.update_item(
            Key=_jobKey(jobId),
            UpdateExpression=updateExpr,
            ConditionExpression=Attr("status").eq(fromStatus),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def resetStuckSubmitting(jobId):
    """Maintenance-only recovery: a job stuck in `submitting` past the
    reconciliation grace window means the runner died mid-submit (crashed,
    or the invocation itself was lost, after claiming the job but before
    reaching provider.submit()). Reset it to `queued` so the ordinary
    idempotent submitJob() entrypoint can safely retry it. Still a
    conditional write (status must still be `submitting`) so a
    late-arriving real result from the original invocation can't be
    clobbered by a racing reconciliation sweep."""
    return transitionStatus(jobId, STATUS_SUBMITTING, STATUS_QUEUED)


def cancelJob(jobId):
    """Conditional write: cancels a job only while its status is still
    non-terminal. Returns the updated item on success, False if the job
    exists but is already terminal (cannot be cancelled -- routes.py turns
    this into a 409), or None if the job doesn't exist at all (-> 404)."""
    table = _tbl()
    now = _isoNowUtc()
    try:
        table.update_item(
            Key=_jobKey(jobId),
            UpdateExpression="SET #s = :s, updatedAt = :u REMOVE statusKey",
            ConditionExpression=Attr("PK").exists() & Attr("status").is_in(list(NON_TERMINAL_STATUSES)),
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": STATUS_CANCELLED, ":u": now},
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise
        return None if getJob(jobId) is None else False
    return getJob(jobId)


# --- reads -----------------------------------------------------------------------


def listJobs(status=None, limit=DEFAULT_LIST_LIMIT, cursor=None, createdBy=None):
    """Full-Scan listing, sorted by createdAt descending (newest first).

    Neither declared GSI supports "all jobs, newest first, optionally
    filtered by status" directly: byStatusTime is sparse (a
    completed/failed/cancelled job has no statusKey at all, see
    transitionStatus), and byCreator would need to be scoped to one
    creator, which the frozen API contract's ListJobsParams (no createdBy
    field) never asks for -- v1 is admin-only and every admin sees every
    job. A full Scan is the same precedent already used on this
    low-volume, admin-only table elsewhere in this codebase (see
    social/storage.py's countHeartbeat / findStuckProcessingTargets) --
    the design doc's own cost model puts real volume at ~40 jobs/month, and
    the 90-day TTL keeps the table from growing without bound.

    `cursor` is an opaque jobId ("resume after this job in the sorted
    list"), not a raw DynamoDB ExclusiveStartKey -- correctness of the
    recency sort matters more than avoiding a full scan at this volume.
    Returns (jobs, nextCursor); nextCursor is None once the list is
    exhausted.
    """
    table = _tbl()
    items = []
    kwargs = {}
    # createdBy is a SECURITY boundary, not a convenience filter: this module
    # is open to all authenticated users, so an unscoped scan would return
    # every user's jobs to every caller. Only an admin may pass None.
    conditions = []
    if status:
        conditions.append(Attr("status").eq(status))
    if createdBy is not None:
        conditions.append(Attr("createdBy").eq(createdBy))
    if conditions:
        expr = conditions[0]
        for extra in conditions[1:]:
            expr = expr & extra
        kwargs["FilterExpression"] = expr
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lastKey = resp.get("LastEvaluatedKey")
        if not lastKey:
            break
        kwargs["ExclusiveStartKey"] = lastKey

    items.sort(key=lambda i: i.get("createdAt", ""), reverse=True)

    startIndex = 0
    if cursor:
        for i, item in enumerate(items):
            if item.get("jobId") == cursor:
                startIndex = i + 1
                break

    effectiveLimit = limit or DEFAULT_LIST_LIMIT
    page = items[startIndex:startIndex + effectiveLimit]
    hasMore = (startIndex + effectiveLimit) < len(items)
    nextCursor = page[-1]["jobId"] if page and hasMore else None
    return page, nextCursor


def findStuckJobs(olderThanMinutes):
    """Non-terminal jobs (any of queued/submitting/processing) whose
    updatedAt is older than the cutoff -- i.e. their async runner invoke or
    EventBridge check schedule was lost. Three separate byStatusTime
    queries (one per non-terminal statusKey value) because DynamoDB Query
    requires an exact hash-key match; a single Scan would also work but
    this stays cheap and index-driven even as the table grows."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=olderThanMinutes)
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    table = _tbl()
    found = []
    for status in NON_TERMINAL_STATUSES:
        kwargs = {
            "IndexName": "byStatusTime",
            "KeyConditionExpression": Key("statusKey").eq(f"STATUS#{status}") & Key("updatedAt").lt(cutoff),
        }
        while True:
            resp = table.query(**kwargs)
            found.extend(resp.get("Items", []))
            lastKey = resp.get("LastEvaluatedKey")
            if not lastKey:
                break
            kwargs["ExclusiveStartKey"] = lastKey
    return found


def countByStatus():
    """Scan-based counts for the daily heartbeat -- same full-Scan-is-fine
    rationale as listJobs above."""
    table = _tbl()
    counts = {s: 0 for s in ALL_STATUSES}
    kwargs = {}
    while True:
        resp = table.scan(**kwargs)
        for item in resp.get("Items", []):
            s = item.get("status")
            if s in counts:
                counts[s] += 1
        lastKey = resp.get("LastEvaluatedKey")
        if not lastKey:
            break
        kwargs["ExclusiveStartKey"] = lastKey
    return counts


def setBudgetIdentity(jobId, identity):
    """Record which budget a job's hold was placed against.

    The runner settles that hold long after the HTTP request (and its JWT
    claims) are gone, and jobs key ownership on the Cognito `sub` while
    budgets key on email -- so the budget identity has to travel on the job
    rather than being re-derived later.
    """
    _tbl().update_item(
        Key=_jobKey(jobId),
        UpdateExpression="SET budgetIdentity = :identity",
        ExpressionAttributeValues={":identity": identity or ""},
    )
