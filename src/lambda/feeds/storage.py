"""DynamoDB storage layer for the isolated feeds module (table: ``fus-feeds``).

Single-table key layout:
  User prefs         PK=USER#{sub}                  SK=PREFS
  Feed               PK=USER#{sub}                  SK=FEED#{feedId}
  Push slug index    PK=USER#{sub}                  SK=SLUG#{slug}
  Poll URL index     PK=USER#{sub}                  SK=URL#{urlHash}
  Feed item          PK=FEED#{sub}#{feedId}         SK=DAY#{yyyy-mm-dd}#ITEM#{itemHash}
  Item dedupe ref    PK=FEED#{sub}#{feedId}         SK=GUID#{itemHash}
  Day count index    PK=FEED#{sub}#{feedId}         SK=DAYIDX#{yyyy-mm-dd}
  Star list row      PK=USER#{sub}                  SK=STAR#{starredAt}#{feedId}#{itemHash}
  Star lookup ref    PK=USER#{sub}                  SK=STARREF#{feedId}#{itemSk}
  Seen list row      PK=USER#{sub}                  SK=SEEN#{seenAt}#{feedId}#{itemHash}
  Seen lookup ref    PK=USER#{sub}                  SK=SEENREF#{feedId}#{itemSk}
  API key row        PK=USER#{sub}                  SK=APIKEY#{keyId}
  API key lookup     PK=APIKEYHASH#{sha256}         SK=META
  Rate limit bucket  PK=RATELIMIT#{keyId}#{min}     SK=META
  Async feed cleanup PK=CLEANUP                     SK=FEED#{sub}#{feedId}

Every numeric write converts raw ``float`` values via ``Decimal(str(v))`` (leaving
``bool`` and ``int`` intact), and all low-level transactions/batches serialize through
boto3's ``TypeSerializer`` so float-rejection matches live DynamoDB in unit tests.
"""

import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import hmac
import json
import math
import os
import random
import re
import secrets
import threading
import time
import uuid

from boto3.dynamodb.conditions import Attr, Key
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError

from feeds.parser import DEFAULT_TZ, computeDay, resolveTimezone

_SER = TypeSerializer()
_DESER = TypeDeserializer()

_threadLocal = threading.local()
_client = None
_clientLock = threading.Lock()

MAX_ACTIVE_KEYS = 20
DEFAULT_SYNC_DELETE_LIMIT = 500
ITEM_SK_RE = re.compile(r"^DAY#\d{4}-\d{2}-\d{2}#ITEM#[0-9a-f]{24}$")


class FeedError(Exception):
    """Base domain error for feeds storage."""


class DuplicateFeedError(FeedError):
    """Raised when creating a feed with a duplicate URL or slug for the user."""

    def __init__(self, message: str, *, existingFeedId: str | None = None):
        super().__init__(message)
        self.existingFeedId = existingFeedId


class FeedNotFoundError(FeedError):
    """Raised when a feed does not exist or is not owned by the caller."""


class ItemNotFoundError(FeedError):
    """Raised when a feed item does not exist."""


class InvalidCursorError(FeedError):
    """Raised when a pagination cursor is malformed or targets another partition."""


class TooManyKeysError(FeedError):
    """Raised when a user reaches the API key limit."""


def _tableName() -> str:
    return os.environ.get("FEEDS_TABLE", "")


def _resource():
    res = getattr(_threadLocal, "dynamodb", None)
    if res is None:
        import boto3

        res = boto3.session.Session().resource("dynamodb")
        _threadLocal.dynamodb = res
    return res


def _tbl():
    return _resource().Table(_tableName())


def _ddbClient():
    global _client
    if _client is None:
        with _clientLock:
            if _client is None:
                import boto3

                _client = boto3.client("dynamodb")
    return _client


def toDynamoValue(val):
    """Recursively convert Python floats to Decimal(str(val)); preserve bool and int."""
    if isinstance(val, bool):
        return val
    if isinstance(val, float):
        if not math.isfinite(val):
            raise ValueError("Non-finite float cannot be written to DynamoDB")
        return Decimal(str(val))
    if isinstance(val, list):
        return [toDynamoValue(x) for x in val]
    if isinstance(val, tuple):
        return [toDynamoValue(x) for x in val]
    if isinstance(val, dict):
        return {k: toDynamoValue(v) for k, v in val.items()}
    return val


def _serItem(item: dict) -> dict:
    clean = toDynamoValue(item)
    return {k: _SER.serialize(v) for k, v in clean.items()}


def _serVal(val) -> dict:
    return _SER.serialize(toDynamoValue(val))


def _deserItem(avMap: dict) -> dict:
    return {k: _DESER.deserialize(v) for k, v in avMap.items()}


def _fromDynamo(val):
    if isinstance(val, Decimal):
        return int(val) if val == val.to_integral_value() else float(val)
    if isinstance(val, list):
        return [_fromDynamo(x) for x in val]
    if isinstance(val, dict):
        return {k: _fromDynamo(v) for k, v in val.items()}
    return val


def _isoNowUtc(timespec: str = "seconds") -> str:
    return datetime.now(timezone.utc).isoformat(timespec=timespec).replace("+00:00", "Z")


def _isoAfterMinutes(minutes: int) -> str:
    dt = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _isoAfterHours(hours: int) -> str:
    dt = datetime.now(timezone.utc) + timedelta(hours=hours)
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _userPk(sub: str) -> str:
    return f"USER#{sub}"


def _feedSk(feedId: str) -> str:
    return f"FEED#{feedId}"


def _feedPartitionPk(sub: str, feedId: str) -> str:
    return f"FEED#{sub}#{feedId}"


def _urlHash(url: str) -> str:
    return hashlib.sha256(url.strip().encode("utf-8")).hexdigest()[:24]


def _encodeCursor(lek: dict | None) -> str | None:
    if not lek:
        return None
    raw = json.dumps(_fromDynamo(lek), separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decodeCursor(cursor: str | None, *, expectedPk: str, expectedSkPrefix: str | None = None) -> dict | None:
    if not cursor:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as e:
        raise InvalidCursorError("Invalid pagination cursor") from e
    if (
        not isinstance(parsed, dict)
        or set(parsed.keys()) != {"PK", "SK"}
        or parsed.get("PK") != expectedPk
        or not isinstance(parsed.get("SK"), str)
        or len(parsed["SK"].encode("utf-8")) > 1024
    ):
        raise InvalidCursorError("Invalid pagination cursor")
    if expectedSkPrefix and not parsed["SK"].startswith(expectedSkPrefix):
        raise InvalidCursorError("Invalid pagination cursor")
    return parsed


def _batchGetItems(keys: list[dict]) -> list[dict]:
    if not keys:
        return []
    client = _ddbClient()
    tname = _tableName()
    results: list[dict] = []
    for i in range(0, len(keys), 100):
        chunk = [_serItem(k) for k in keys[i : i + 100]]
        req = {tname: {"Keys": chunk}}
        pending = True
        for attempt in range(5):
            resp = client.batch_get_item(RequestItems=req)
            for raw in (resp.get("Responses") or {}).get(tname, []):
                results.append(_deserItem(raw))
            unprocessed = resp.get("UnprocessedKeys") or {}
            if not unprocessed or not unprocessed.get(tname, {}).get("Keys"):
                pending = False
                break
            req = unprocessed
            time.sleep(0.02 * (2**attempt))
        if pending:
            raise RuntimeError("DynamoDB batch_get_item left unprocessed keys after retries")
    return results


def _batchDeleteKeys(keys: list[dict]) -> None:
    if not keys:
        return
    client = _ddbClient()
    tname = _tableName()
    for i in range(0, len(keys), 25):
        req = {tname: [{"DeleteRequest": {"Key": _serItem(k)}} for k in keys[i : i + 25]]}
        pending = True
        for attempt in range(5):
            resp = client.batch_write_item(RequestItems=req)
            unprocessed = resp.get("UnprocessedItems") or {}
            if not unprocessed or not unprocessed.get(tname):
                pending = False
                break
            req = unprocessed
            time.sleep(0.02 * (2**attempt))
        if pending:
            raise RuntimeError("DynamoDB batch_write_item left unprocessed items after retries")


class _FeedDeletedDuringWrite(Exception):
    """Internal signal to abort item upserts if the owning feed is deleted mid-batch."""


def _isConditionFailure(err: ClientError) -> bool:
    code = err.response.get("Error", {}).get("Code", "")
    if code == "ConditionalCheckFailedException":
        return True
    if code == "TransactionCanceledException":
        reasons = err.response.get("CancellationReasons")
        if isinstance(reasons, list):
            return any(isinstance(r, dict) and r.get("Code") == "ConditionalCheckFailed" for r in reasons)
        return False
    return False


def _cancellationReasonAt(err: ClientError, idx: int) -> str | None:
    if err.response.get("Error", {}).get("Code", "") != "TransactionCanceledException":
        return None
    reasons = err.response.get("CancellationReasons")
    if isinstance(reasons, list) and 0 <= idx < len(reasons) and isinstance(reasons[idx], dict):
        return reasons[idx].get("Code")
    return None


def _isTransactionConflict(err: ClientError) -> bool:
    if err.response.get("Error", {}).get("Code", "") != "TransactionCanceledException":
        return False
    reasons = err.response.get("CancellationReasons")
    if not isinstance(reasons, list):
        return False
    hasConflict = any(isinstance(r, dict) and r.get("Code") == "TransactionConflict" for r in reasons)
    hasCondFail = any(isinstance(r, dict) and r.get("Code") == "ConditionalCheckFailed" for r in reasons)
    return hasConflict and not hasCondFail


def _transactWithConflictRetry(txItems: list[dict], *, maxAttempts: int = 4) -> None:
    client = _ddbClient()
    for attempt in range(maxAttempts):
        try:
            client.transact_write_items(TransactItems=txItems)
            return
        except ClientError as e:
            if _isTransactionConflict(e) and attempt + 1 < maxAttempts:
                time.sleep(0.03 * (2**attempt) + random.uniform(0, 0.03))
                continue
            raise


def _normalizeFeed(raw: dict, todayCount: int = 0) -> dict:
    item = _fromDynamo(raw)
    out = {
        "feedId": item["feedId"],
        "title": item["title"],
        "kind": item["kind"],
        "pinned": bool(item.get("pinned", False)),
        "sortOrder": int(item.get("sortOrder", 0)),
        "tz": item.get("tz") or DEFAULT_TZ,
        "createdAt": item["createdAt"],
        "todayCount": int(todayCount),
        "failCount": int(item.get("failCount", 0)),
    }
    for opt in ("slug", "url", "siteUrl", "lastFetchedAt", "lastItemAt", "lastError", "etag", "lastModified", "nextFetchAt"):
        if item.get(opt) is not None:
            out[opt] = item[opt]
    return out


def _normalizeItem(raw: dict, *, starred: bool = False, seen: bool = False) -> dict:
    item = _fromDynamo(raw)
    out = {
        "itemSk": item["SK"],
        "itemHash": item["itemHash"],
        "day": item["day"],
        "title": item["title"],
        "summary": item.get("summary") or "",
        "contentHtml": item.get("contentHtml") or "",
        "publishedAt": item.get("publishedAt") or "",
        "fetchedAt": item.get("fetchedAt") or "",
        "starred": bool(starred),
        "seen": bool(seen),
    }
    for opt in ("link", "author", "guid"):
        if item.get(opt) is not None:
            out[opt] = item[opt]
    return out


def _normalizeStar(raw: dict) -> dict:
    item = _fromDynamo(raw)
    out = {
        "starSk": item["SK"],
        "starredAt": item["starredAt"],
        "feedId": item["feedId"],
        "itemSk": item["itemSk"],
        "itemHash": item["itemHash"],
        "day": item["day"],
        "title": item["title"],
        "snippet": item.get("snippet") or "",
        "feedTitle": item.get("feedTitle") or "",
        "feedKind": item.get("feedKind") or "rss",
    }
    if item.get("link") is not None:
        out["link"] = item["link"]
    return out


def _normalizeSeen(raw: dict) -> dict:
    item = _fromDynamo(raw)
    out = {
        "seenSk": item["SK"],
        "seenAt": item["seenAt"],
        "feedId": item["feedId"],
        "itemSk": item["itemSk"],
        "itemHash": item["itemHash"],
        "day": item["day"],
        "title": item["title"],
        "snippet": item.get("snippet") or "",
        "feedTitle": item.get("feedTitle") or "",
        "feedKind": item.get("feedKind") or "rss",
    }
    if item.get("link") is not None:
        out["link"] = item["link"]
    return out


def _normalizeKey(raw: dict) -> dict:
    item = _fromDynamo(raw)
    out = {
        "keyId": item["keyId"],
        "name": item["name"],
        "prefix": item["prefix"],
        "createdAt": item["createdAt"],
        "revoked": bool(item.get("revoked", False)),
    }
    if item.get("lastUsedAt") is not None:
        out["lastUsedAt"] = item["lastUsedAt"]
    return out


# --- Prefs ---------------------------------------------------------------------


def getUserPrefs(sub: str) -> dict:
    resp = _tbl().get_item(Key={"PK": _userPk(sub), "SK": "PREFS"})
    item = resp.get("Item")
    tz = (item or {}).get("tz") or DEFAULT_TZ
    return {"tz": tz}


def setUserPrefs(sub: str, tz: str) -> dict:
    now = _isoNowUtc()
    _tbl().put_item(
        Item=toDynamoValue(
            {
                "PK": _userPk(sub),
                "SK": "PREFS",
                "tz": tz,
                "updatedAt": now,
            }
        )
    )
    # Keep per-feed tz aligned so the hourly fetcher buckets items in the user's current tz.
    feeds = _queryRawFeeds(sub)
    for f in feeds:
        if f.get("tz") != tz:
            try:
                _tbl().update_item(
                    Key={"PK": f["PK"], "SK": f["SK"]},
                    UpdateExpression="SET #tz = :tz",
                    ConditionExpression="attribute_exists(SK)",
                    ExpressionAttributeNames={"#tz": "tz"},
                    ExpressionAttributeValues={":tz": tz},
                )
            except ClientError as e:
                if not _isConditionFailure(e):
                    raise
    return {"tz": tz}


# --- Feeds ---------------------------------------------------------------------


def _queryRawFeeds(sub: str) -> list[dict]:
    items: list[dict] = []
    kwargs = {
        "KeyConditionExpression": Key("PK").eq(_userPk(sub)) & Key("SK").begins_with("FEED#"),
    }
    while True:
        resp = _tbl().query(**kwargs)
        items.extend(resp.get("Items") or [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return items


def _nextSortOrder(sub: str) -> int:
    feeds = _queryRawFeeds(sub)
    if not feeds:
        return 0
    return max(int(f.get("sortOrder", 0)) for f in feeds) + 1


def listFeeds(sub: str, *, tz: str | None = None) -> list[dict]:
    rawFeeds = _queryRawFeeds(sub)
    if not rawFeeds:
        return []
    tzName = tz or getUserPrefs(sub)["tz"]
    today = datetime.now(resolveTimezone(tzName)).strftime("%Y-%m-%d")

    dayKeys = [{"PK": _feedPartitionPk(sub, f["feedId"]), "SK": f"DAYIDX#{today}"} for f in rawFeeds]
    dayRows = _batchGetItems(dayKeys)
    countsByPk = {r["PK"]: int(r.get("count", 0)) for r in dayRows}

    out = [
        _normalizeFeed(f, todayCount=countsByPk.get(_feedPartitionPk(sub, f["feedId"]), 0))
        for f in rawFeeds
    ]
    out.sort(key=lambda f: (not f["pinned"], f["sortOrder"], f["title"].lower()))
    return out


def getFeed(sub: str, feedId: str) -> dict | None:
    resp = _tbl().get_item(Key={"PK": _userPk(sub), "SK": _feedSk(feedId)})
    item = resp.get("Item")
    if not item:
        return None
    today = datetime.now(resolveTimezone(item.get("tz"))).strftime("%Y-%m-%d")
    dayResp = _tbl().get_item(Key={"PK": _feedPartitionPk(sub, feedId), "SK": f"DAYIDX#{today}"})
    todayCount = int((dayResp.get("Item") or {}).get("count", 0))
    return _normalizeFeed(item, todayCount=todayCount)


def createPolledFeed(
    sub: str,
    *,
    title: str,
    kind: str,
    url: str,
    siteUrl: str | None,
    etag: str | None,
    lastModified: str | None,
    tz: str,
) -> dict:
    tname = _tableName()
    feedId = str(uuid.uuid4())
    now = _isoNowUtc()
    nextFetchAt = _isoAfterMinutes(55)
    sortOrder = _nextSortOrder(sub)
    urlKey = f"URL#{_urlHash(url)}"

    feedItem = {
        "PK": _userPk(sub),
        "SK": _feedSk(feedId),
        "feedId": feedId,
        "sub": sub,
        "title": title,
        "kind": kind,
        "url": url,
        "pinned": False,
        "sortOrder": sortOrder,
        "tz": tz,
        "createdAt": now,
        "lastFetchedAt": now,
        "failCount": 0,
        "fetchKey": "POLL",
        "nextFetchAt": nextFetchAt,
    }
    if siteUrl:
        feedItem["siteUrl"] = siteUrl
    if etag:
        feedItem["etag"] = etag
    if lastModified:
        feedItem["lastModified"] = lastModified

    urlItem = {
        "PK": _userPk(sub),
        "SK": urlKey,
        "feedId": feedId,
        "url": url,
        "createdAt": now,
    }

    try:
        _transactWithConflictRetry(
            [
                {"Put": {"TableName": tname, "Item": _serItem(feedItem), "ConditionExpression": "attribute_not_exists(SK)"}},
                {"Put": {"TableName": tname, "Item": _serItem(urlItem), "ConditionExpression": "attribute_not_exists(SK)"}},
            ]
        )
    except ClientError as e:
        if _isConditionFailure(e):
            existing = _tbl().get_item(Key={"PK": _userPk(sub), "SK": urlKey}).get("Item") or {}
            raise DuplicateFeedError("Feed URL already subscribed", existingFeedId=existing.get("feedId")) from e
        raise

    return _normalizeFeed(feedItem, todayCount=0)


def createPushFeed(sub: str, *, title: str, slug: str, tz: str) -> dict:
    tname = _tableName()
    feedId = str(uuid.uuid4())
    now = _isoNowUtc()
    sortOrder = _nextSortOrder(sub)
    slugKey = f"SLUG#{slug}"

    feedItem = {
        "PK": _userPk(sub),
        "SK": _feedSk(feedId),
        "feedId": feedId,
        "sub": sub,
        "title": title,
        "kind": "push",
        "slug": slug,
        "pinned": False,
        "sortOrder": sortOrder,
        "tz": tz,
        "createdAt": now,
        "failCount": 0,
    }
    slugItem = {
        "PK": _userPk(sub),
        "SK": slugKey,
        "feedId": feedId,
        "slug": slug,
        "createdAt": now,
    }

    try:
        _transactWithConflictRetry(
            [
                {"Put": {"TableName": tname, "Item": _serItem(feedItem), "ConditionExpression": "attribute_not_exists(SK)"}},
                {"Put": {"TableName": tname, "Item": _serItem(slugItem), "ConditionExpression": "attribute_not_exists(SK)"}},
            ]
        )
    except ClientError as e:
        if _isConditionFailure(e):
            existing = _tbl().get_item(Key={"PK": _userPk(sub), "SK": slugKey}).get("Item") or {}
            raise DuplicateFeedError("Feed slug already exists", existingFeedId=existing.get("feedId")) from e
        raise

    return _normalizeFeed(feedItem, todayCount=0)


def getOrCreatePushFeedBySlug(sub: str, *, slug: str, title: str, tz: str) -> tuple[dict, bool]:
    slugKey = f"SLUG#{slug}"
    slugRow = _tbl().get_item(Key={"PK": _userPk(sub), "SK": slugKey}).get("Item")
    if slugRow and slugRow.get("feedId"):
        feed = getFeed(sub, slugRow["feedId"])
        if feed is not None:
            return feed, False

    try:
        return createPushFeed(sub, title=title, slug=slug, tz=tz), True
    except DuplicateFeedError as e:
        if e.existingFeedId:
            feed = getFeed(sub, e.existingFeedId)
            if feed is not None:
                return feed, False
        raise


def updateFeed(
    sub: str,
    feedId: str,
    *,
    title: str | None = None,
    pinned: bool | None = None,
    sortOrder: int | None = None,
) -> dict | None:
    sets: list[str] = []
    names: dict[str, str] = {}
    values: dict[str, object] = {}

    if title is not None:
        sets.append("#title = :title")
        names["#title"] = "title"
        values[":title"] = title
    if pinned is not None:
        sets.append("#pinned = :pinned")
        names["#pinned"] = "pinned"
        values[":pinned"] = pinned
    if sortOrder is not None:
        sets.append("#sortOrder = :sortOrder")
        names["#sortOrder"] = "sortOrder"
        values[":sortOrder"] = int(sortOrder)

    if not sets:
        return getFeed(sub, feedId)

    try:
        resp = _tbl().update_item(
            Key={"PK": _userPk(sub), "SK": _feedSk(feedId)},
            UpdateExpression="SET " + ", ".join(sets),
            ConditionExpression="attribute_exists(SK)",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=toDynamoValue(values),
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return None
        raise

    item = resp["Attributes"]
    today = datetime.now(resolveTimezone(item.get("tz"))).strftime("%Y-%m-%d")
    dayResp = _tbl().get_item(Key={"PK": _feedPartitionPk(sub, feedId), "SK": f"DAYIDX#{today}"})
    todayCount = int((dayResp.get("Item") or {}).get("count", 0))
    return _normalizeFeed(item, todayCount=todayCount)


def reorderFeeds(sub: str, feedIds: list[str]) -> list[str]:
    existing = _queryRawFeeds(sub)
    byId = {f["feedId"]: f for f in existing}
    for fid in feedIds:
        if fid not in byId:
            raise FeedNotFoundError(f"Feed not found: {fid}")

    remaining = [f["feedId"] for f in sorted(existing, key=lambda x: (int(x.get("sortOrder", 0)), x["title"].lower())) if f["feedId"] not in set(feedIds)]
    finalOrder = list(feedIds) + remaining
    for idx, fid in enumerate(finalOrder):
        try:
            _tbl().update_item(
                Key={"PK": _userPk(sub), "SK": _feedSk(fid)},
                UpdateExpression="SET #so = :so",
                ConditionExpression="attribute_exists(SK)",
                ExpressionAttributeNames={"#so": "sortOrder"},
                ExpressionAttributeValues={":so": idx},
            )
        except ClientError as e:
            if _isConditionFailure(e):
                raise FeedNotFoundError(f"Feed not found: {fid}") from e
            raise
    return finalOrder


def deleteFeed(sub: str, feedId: str, *, maxSyncDelete: int = DEFAULT_SYNC_DELETE_LIMIT) -> bool:
    resp = _tbl().get_item(Key={"PK": _userPk(sub), "SK": _feedSk(feedId)})
    feed = resp.get("Item")
    if not feed:
        return False

    feedPk = _feedPartitionPk(sub, feedId)
    tname = _tableName()
    txItems = [
        {
            "Delete": {
                "TableName": tname,
                "Key": _serItem({"PK": _userPk(sub), "SK": _feedSk(feedId)}),
                "ConditionExpression": "attribute_exists(SK)",
            }
        },
        {
            "Put": {
                "TableName": tname,
                "Item": _serItem(
                    {
                        "PK": "CLEANUP",
                        "SK": feedPk,
                        "sub": sub,
                        "feedId": feedId,
                        "createdAt": _isoNowUtc(),
                    }
                ),
            }
        },
    ]
    if feed.get("kind") == "push" and feed.get("slug"):
        txItems.append({"Delete": {"TableName": tname, "Key": _serItem({"PK": _userPk(sub), "SK": f"SLUG#{feed['slug']}"})}})
    elif feed.get("url"):
        txItems.append({"Delete": {"TableName": tname, "Key": _serItem({"PK": _userPk(sub), "SK": f"URL#{_urlHash(feed['url'])}"})}})

    try:
        _transactWithConflictRetry(txItems)
    except ClientError as e:
        if _isConditionFailure(e):
            return False
        raise

    deletedCount = 0
    hasMore = False
    lek = None

    while deletedCount < maxSyncDelete:
        pageLimit = min(100, maxSyncDelete - deletedCount)
        qkwargs = {
            "KeyConditionExpression": Key("PK").eq(feedPk),
            "ProjectionExpression": "PK, SK",
            "Limit": pageLimit,
        }
        if lek:
            qkwargs["ExclusiveStartKey"] = lek
        qresp = _tbl().query(**qkwargs)
        batchKeys = [{"PK": r["PK"], "SK": r["SK"]} for r in (qresp.get("Items") or [])]
        if batchKeys:
            _batchDeleteKeys(batchKeys)
            deletedCount += len(batchKeys)
        lek = qresp.get("LastEvaluatedKey")
        if not lek:
            hasMore = False
            break
        hasMore = True

    if not hasMore:
        _tbl().delete_item(Key={"PK": "CLEANUP", "SK": feedPk})
    return True


def sweepDeletedFeedCleanup(maxDeletes: int = 250) -> int:
    """Finish removing orphaned items from large feeds deleted asynchronously."""
    qresp = _tbl().query(KeyConditionExpression=Key("PK").eq("CLEANUP"), Limit=20)
    jobs = qresp.get("Items") or []
    totalDeleted = 0

    for job in jobs:
        if totalDeleted >= maxDeletes:
            break
        feedPk = job["SK"]
        remainingBudget = maxDeletes - totalDeleted
        qItems = _tbl().query(
            KeyConditionExpression=Key("PK").eq(feedPk),
            ProjectionExpression="PK, SK",
            Limit=remainingBudget,
        )
        rows = qItems.get("Items") or []
        if rows:
            _batchDeleteKeys([{"PK": r["PK"], "SK": r["SK"]} for r in rows])
            totalDeleted += len(rows)
        if not qItems.get("LastEvaluatedKey"):
            _tbl().delete_item(Key={"PK": "CLEANUP", "SK": feedPk})
    return totalDeleted


# --- Items & Fetch Metadata ----------------------------------------------------


def _dedupeIncoming(items: list[dict], *, allowOverwrite: bool) -> list[dict]:
    byHash: dict[str, dict] = {}
    for it in items:
        h = it["itemHash"]
        if h not in byHash or allowOverwrite:
            byHash[h] = it
    return list(byHash.values())


def _buildEntryItem(feedPk: str, it: dict) -> dict:
    day = it["day"]
    itemHash = it["itemHash"]
    itemSk = f"DAY#{day}#ITEM#{itemHash}"
    entry = {
        "PK": feedPk,
        "SK": itemSk,
        "itemHash": itemHash,
        "day": day,
        "title": it["title"],
        "summary": it.get("summary") or "",
        "contentHtml": it.get("contentHtml") or "",
        "publishedAt": it["publishedAt"],
        "fetchedAt": it["fetchedAt"],
    }
    for opt in ("link", "author", "guid"):
        if it.get(opt):
            entry[opt] = it[opt]
    return entry


def _cleanupEmptyDayIdx(feedPk: str, day: str) -> None:
    try:
        _tbl().delete_item(
            Key={"PK": feedPk, "SK": f"DAYIDX#{day}"},
            ConditionExpression="#cnt <= :zero",
            ExpressionAttributeNames={"#cnt": "count"},
            ExpressionAttributeValues={":zero": 0},
        )
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") != "ConditionalCheckFailedException":
            raise


def _feedExistsCheck(tname: str, sub: str, feedId: str) -> dict:
    return {
        "ConditionCheck": {
            "TableName": tname,
            "Key": _serItem({"PK": _userPk(sub), "SK": _feedSk(feedId)}),
            "ConditionExpression": "attribute_exists(SK)",
        }
    }


def _overwriteExistingItem(tname: str, sub: str, feedId: str, feedPk: str, existing: dict, it: dict) -> None:
    entry = _buildEntryItem(feedPk, it)
    newDay = it["day"]
    newSk = entry["SK"]
    oldDay = existing["day"]
    oldSk = existing["itemSk"]
    guidKey = {"PK": feedPk, "SK": f"GUID#{it['itemHash']}"}

    guidItem = {
        "PK": feedPk,
        "SK": f"GUID#{it['itemHash']}",
        "day": newDay,
        "itemSk": newSk,
        "publishedAt": it["publishedAt"],
        "fetchedAt": it["fetchedAt"],
    }

    feedCheck = _feedExistsCheck(tname, sub, feedId)

    if oldDay == newDay:
        _transactWithConflictRetry(
            [
                feedCheck,
                {"Put": {"TableName": tname, "Item": _serItem(entry)}},
                {
                    "Update": {
                        "TableName": tname,
                        "Key": _serItem(guidKey),
                        "UpdateExpression": "SET publishedAt = :pub, fetchedAt = :fet",
                        "ConditionExpression": "#d = :oldDay",
                        "ExpressionAttributeNames": {"#d": "day"},
                        "ExpressionAttributeValues": {
                            ":pub": _serVal(it["publishedAt"]),
                            ":fet": _serVal(it["fetchedAt"]),
                            ":oldDay": _serVal(oldDay),
                        },
                    }
                },
            ]
        )
    else:
        _transactWithConflictRetry(
            [
                feedCheck,
                {"Delete": {"TableName": tname, "Key": _serItem({"PK": feedPk, "SK": oldSk})}},
                {"Put": {"TableName": tname, "Item": _serItem(entry)}},
                {
                    "Put": {
                        "TableName": tname,
                        "Item": _serItem(guidItem),
                        "ConditionExpression": "#d = :oldDay",
                        "ExpressionAttributeNames": {"#d": "day"},
                        "ExpressionAttributeValues": {":oldDay": _serVal(oldDay)},
                    }
                },
                {
                    "Update": {
                        "TableName": tname,
                        "Key": _serItem({"PK": feedPk, "SK": f"DAYIDX#{oldDay}"}),
                        "UpdateExpression": "ADD #cnt :neg",
                        "ExpressionAttributeNames": {"#cnt": "count"},
                        "ExpressionAttributeValues": {":neg": _serVal(-1)},
                    }
                },
                {
                    "Update": {
                        "TableName": tname,
                        "Key": _serItem({"PK": feedPk, "SK": f"DAYIDX#{newDay}"}),
                        "UpdateExpression": "SET #day = :day ADD #cnt :one",
                        "ExpressionAttributeNames": {"#day": "day", "#cnt": "count"},
                        "ExpressionAttributeValues": {":day": _serVal(newDay), ":one": _serVal(1)},
                    }
                },
            ]
        )
        _cleanupEmptyDayIdx(feedPk, oldDay)


def _applyOverwriteWithRetry(tname: str, sub: str, feedId: str, feedPk: str, existing: dict, it: dict) -> dict | None:
    h = it["itemHash"]
    try:
        _overwriteExistingItem(tname, sub, feedId, feedPk, existing, it)
        return {**existing, "day": it["day"], "itemSk": f"DAY#{it['day']}#ITEM#{h}"}
    except ClientError as e:
        if _cancellationReasonAt(e, 0) == "ConditionalCheckFailed":
            raise _FeedDeletedDuringWrite() from e
        if not _isConditionFailure(e):
            raise
        raced = _tbl().get_item(Key={"PK": feedPk, "SK": f"GUID#{h}"}).get("Item")
        if not raced:
            return None
        try:
            _overwriteExistingItem(tname, sub, feedId, feedPk, raced, it)
        except ClientError as e2:
            if _cancellationReasonAt(e2, 0) == "ConditionalCheckFailed":
                raise _FeedDeletedDuringWrite() from e2
            raise
        return {**raced, "day": it["day"], "itemSk": f"DAY#{it['day']}#ITEM#{h}"}


def upsertItems(
    sub: str,
    feedId: str,
    preparedItems: list[dict],
    *,
    allowOverwrite: bool = False,
) -> tuple[int, int]:
    """Insert new items (updating DAYIDX + GUID index atomically); optionally overwrite on re-ingest."""
    uniqueItems = _dedupeIncoming(preparedItems, allowOverwrite=allowOverwrite)
    if not uniqueItems:
        return 0, 0

    tname = _tableName()
    feedPk = _feedPartitionPk(sub, feedId)
    guidKeys = [{"PK": feedPk, "SK": f"GUID#{it['itemHash']}"} for it in uniqueItems]
    existingRows = _batchGetItems(guidKeys)
    existingByHash = {r["SK"].removeprefix("GUID#"): r for r in existingRows}

    added = 0
    updated = 0

    try:
        for it in uniqueItems:
            h = it["itemHash"]
            existing = existingByHash.get(h)
            if existing is not None:
                if not allowOverwrite:
                    continue
                after = _applyOverwriteWithRetry(tname, sub, feedId, feedPk, existing, it)
                if after is not None:
                    existingByHash[h] = after
                    updated += 1
                continue

            entry = _buildEntryItem(feedPk, it)
            guidItem = {
                "PK": feedPk,
                "SK": f"GUID#{h}",
                "day": it["day"],
                "itemSk": entry["SK"],
                "publishedAt": it["publishedAt"],
                "fetchedAt": it["fetchedAt"],
            }
            try:
                _transactWithConflictRetry(
                    [
                        _feedExistsCheck(tname, sub, feedId),
                        {"Put": {"TableName": tname, "Item": _serItem(guidItem), "ConditionExpression": "attribute_not_exists(SK)"}},
                        {"Put": {"TableName": tname, "Item": _serItem(entry)}},
                        {
                            "Update": {
                                "TableName": tname,
                                "Key": _serItem({"PK": feedPk, "SK": f"DAYIDX#{it['day']}"}),
                                "UpdateExpression": "SET #day = :day ADD #cnt :one",
                                "ExpressionAttributeNames": {"#day": "day", "#cnt": "count"},
                                "ExpressionAttributeValues": {":day": _serVal(it["day"]), ":one": _serVal(1)},
                            }
                        },
                    ]
                )
                added += 1
                existingByHash[h] = guidItem
            except ClientError as e:
                if _cancellationReasonAt(e, 0) == "ConditionalCheckFailed":
                    break
                if not _isConditionFailure(e):
                    raise
                raced = _tbl().get_item(Key={"PK": feedPk, "SK": f"GUID#{h}"}).get("Item")
                if raced and allowOverwrite:
                    after = _applyOverwriteWithRetry(tname, sub, feedId, feedPk, raced, it)
                    if after is not None:
                        existingByHash[h] = after
                        updated += 1
    except _FeedDeletedDuringWrite:
        pass

    return added, updated


def touchPushFeedActivity(
    sub: str,
    feedId: str,
    *,
    lastItemAt: str | None = None,
    currentLastItemAt: str | None = None,
) -> None:
    now = _isoNowUtc()
    expr = "SET lastFetchedAt = :now"
    vals: dict[str, object] = {":now": now}
    if lastItemAt and (not currentLastItemAt or lastItemAt > currentLastItemAt):
        expr += ", lastItemAt = :lastItem"
        vals[":lastItem"] = lastItemAt
    try:
        _tbl().update_item(
            Key={"PK": _userPk(sub), "SK": _feedSk(feedId)},
            UpdateExpression=expr,
            ConditionExpression="attribute_exists(SK)",
            ExpressionAttributeValues=toDynamoValue(vals),
        )
    except ClientError as e:
        if not _isConditionFailure(e):
            raise


def recordFetchSuccess(
    sub: str,
    feedId: str,
    *,
    etag: str | None,
    lastModified: str | None,
    lastItemAt: str | None,
    currentLastItemAt: str | None = None,
    notModified: bool = False,
    nextFetchAt: str | None = None,
) -> None:
    now = _isoNowUtc()
    nxt = nextFetchAt or _isoAfterMinutes(55)
    sets = ["lastFetchedAt = :now", "nextFetchAt = :nxt", "failCount = :zero"]
    vals: dict[str, object] = {":now": now, ":nxt": nxt, ":zero": 0}
    removes = ["lastError"]

    if etag:
        sets.append("etag = :etag")
        vals[":etag"] = etag
    elif not notModified:
        removes.append("etag")

    if lastModified:
        sets.append("lastModified = :lm")
        vals[":lm"] = lastModified
    elif not notModified:
        removes.append("lastModified")

    if lastItemAt and (not currentLastItemAt or lastItemAt > currentLastItemAt):
        sets.append("lastItemAt = :li")
        vals[":li"] = lastItemAt

    expr = "SET " + ", ".join(sets) + " REMOVE " + ", ".join(removes)
    try:
        _tbl().update_item(
            Key={"PK": _userPk(sub), "SK": _feedSk(feedId)},
            UpdateExpression=expr,
            ConditionExpression="attribute_exists(SK)",
            ExpressionAttributeValues=toDynamoValue(vals),
        )
    except ClientError as e:
        if not _isConditionFailure(e):
            raise


def recordFetchFailure(
    sub: str,
    feedId: str,
    *,
    errorMessage: str,
    failCount: int,
    nextFetchAt: str | None = None,
) -> None:
    now = _isoNowUtc()
    backoffHours = min(24, 2 ** max(1, failCount))
    nxt = nextFetchAt or _isoAfterHours(backoffHours)
    try:
        _tbl().update_item(
            Key={"PK": _userPk(sub), "SK": _feedSk(feedId)},
            UpdateExpression="SET lastFetchedAt = :now, lastError = :err, failCount = :fc, nextFetchAt = :nxt",
            ConditionExpression="attribute_exists(SK)",
            ExpressionAttributeValues=toDynamoValue(
                {
                    ":now": now,
                    ":err": errorMessage[:500],
                    ":fc": int(failCount),
                    ":nxt": nxt,
                }
            ),
        )
    except ClientError as e:
        if not _isConditionFailure(e):
            raise


def queryDueFeeds(nowIso: str, *, limit: int = 200) -> list[dict]:
    items: list[dict] = []
    kwargs = {
        "IndexName": "byFetchDue",
        "KeyConditionExpression": Key("fetchKey").eq("POLL") & Key("nextFetchAt").lte(nowIso),
        "Limit": limit,
    }
    while len(items) < limit:
        resp = _tbl().query(**kwargs)
        items.extend(resp.get("Items") or [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return [_fromDynamo(x) for x in items[:limit]]


def listDays(sub: str, feedId: str, *, limit: int = 60, cursor: str | None = None) -> dict:
    feed = getFeed(sub, feedId)
    if feed is None:
        raise FeedNotFoundError("Feed not found")

    feedPk = _feedPartitionPk(sub, feedId)
    curLek = _decodeCursor(cursor, expectedPk=feedPk, expectedSkPrefix="DAYIDX#")
    days: list[dict] = []
    while True:
        kwargs = {
            "KeyConditionExpression": Key("PK").eq(feedPk) & Key("SK").begins_with("DAYIDX#"),
            "FilterExpression": Attr("count").gt(0),
            "ScanIndexForward": False,
            "Limit": limit,
        }
        if curLek:
            kwargs["ExclusiveStartKey"] = curLek
        resp = _tbl().query(**kwargs)
        days.extend(
            {"day": r.get("day") or r["SK"].removeprefix("DAYIDX#"), "count": int(r["count"])}
            for r in (resp.get("Items") or [])
            if int(r.get("count", 0)) > 0
        )
        curLek = resp.get("LastEvaluatedKey")
        if days or not curLek:
            break
    return {
        "days": days,
        "nextCursor": _encodeCursor(curLek),
    }


def listDayItems(sub: str, feedId: str, day: str) -> tuple[dict, list[dict]]:
    feed = getFeed(sub, feedId)
    if feed is None:
        raise FeedNotFoundError("Feed not found")

    feedPk = _feedPartitionPk(sub, feedId)
    rawItems: list[dict] = []
    kwargs = {
        "KeyConditionExpression": Key("PK").eq(feedPk) & Key("SK").begins_with(f"DAY#{day}#ITEM#"),
    }
    while True:
        resp = _tbl().query(**kwargs)
        rawItems.extend(resp.get("Items") or [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek

    rawItems.sort(key=lambda r: (r.get("publishedAt") or "", r.get("SK") or ""), reverse=True)
    # One round-trip for BOTH marker kinds: STARREF# and SEENREF# keys share a single
    # _batchGetItems call, then rows are partitioned by their SK prefix.
    upk = _userPk(sub)
    refKeys = [{"PK": upk, "SK": f"STARREF#{feedId}#{r['SK']}"} for r in rawItems]
    refKeys += [{"PK": upk, "SK": f"SEENREF#{feedId}#{r['SK']}"} for r in rawItems]
    refRows = _batchGetItems(refKeys)
    starredSks = {r["itemSk"] for r in refRows if str(r.get("SK", "")).startswith("STARREF#")}
    seenSks = {r["itemSk"] for r in refRows if str(r.get("SK", "")).startswith("SEENREF#")}

    items = [_normalizeItem(r, starred=(r["SK"] in starredSks), seen=(r["SK"] in seenSks)) for r in rawItems]
    return feed, items


# --- Stars ---------------------------------------------------------------------


def starItem(sub: str, feedId: str, itemSk: str) -> dict:
    if not ITEM_SK_RE.match(itemSk or ""):
        raise ItemNotFoundError("Invalid item key")
    feed = getFeed(sub, feedId)
    if feed is None:
        raise FeedNotFoundError("Feed not found")

    itemResp = _tbl().get_item(Key={"PK": _feedPartitionPk(sub, feedId), "SK": itemSk})
    item = itemResp.get("Item")
    if not item:
        raise ItemNotFoundError("Item not found")

    starRefSk = f"STARREF#{feedId}#{itemSk}"
    tname = _tableName()
    itemHash = item["itemHash"]

    for attempt in range(2):
        existingRef = _tbl().get_item(Key={"PK": _userPk(sub), "SK": starRefSk}).get("Item")
        if existingRef and existingRef.get("starSk"):
            existingStar = _tbl().get_item(Key={"PK": _userPk(sub), "SK": existingRef["starSk"]}).get("Item")
            if existingStar:
                return _normalizeStar(existingStar)

        starredAt = _isoNowUtc(timespec="milliseconds")
        starSk = f"STAR#{starredAt}#{feedId}#{itemHash}"
        starRow = {
            "PK": _userPk(sub),
            "SK": starSk,
            "starredAt": starredAt,
            "feedId": feedId,
            "itemSk": itemSk,
            "itemHash": itemHash,
            "day": item["day"],
            "title": item["title"],
            "snippet": (item.get("summary") or "")[:240],
            "feedTitle": feed["title"],
            "feedKind": feed["kind"],
        }
        if item.get("link"):
            starRow["link"] = item["link"]

        starRefRow = {
            "PK": _userPk(sub),
            "SK": starRefSk,
            "starSk": starSk,
            "feedId": feedId,
            "itemSk": itemSk,
            "starredAt": starredAt,
        }

        try:
            _transactWithConflictRetry(
                [
                    {"Put": {"TableName": tname, "Item": _serItem(starRow)}},
                    {"Put": {"TableName": tname, "Item": _serItem(starRefRow), "ConditionExpression": "attribute_not_exists(SK)"}},
                ]
            )
            return _normalizeStar(starRow)
        except ClientError as e:
            if not _isConditionFailure(e):
                raise
            existingRef = _tbl().get_item(Key={"PK": _userPk(sub), "SK": starRefSk}).get("Item") or {}
            if existingRef.get("starSk"):
                existingStar = _tbl().get_item(Key={"PK": _userPk(sub), "SK": existingRef["starSk"]}).get("Item")
                if existingStar:
                    return _normalizeStar(existingStar)
            if attempt == 0:
                continue
            raise


def unstarItem(sub: str, feedId: str, itemSk: str) -> None:
    starRefSk = f"STARREF#{feedId}#{itemSk}"
    tname = _tableName()

    for attempt in range(3):
        ref = _tbl().get_item(Key={"PK": _userPk(sub), "SK": starRefSk}).get("Item")
        if not ref:
            return

        starRefKey = _serItem({"PK": _userPk(sub), "SK": starRefSk})
        if ref.get("starSk"):
            txItems = [
                {
                    "Delete": {
                        "TableName": tname,
                        "Key": starRefKey,
                        "ConditionExpression": "starSk = :expected",
                        "ExpressionAttributeValues": {":expected": _serVal(ref["starSk"])},
                    }
                },
                {"Delete": {"TableName": tname, "Key": _serItem({"PK": _userPk(sub), "SK": ref["starSk"]})}},
            ]
        else:
            txItems = [
                {
                    "Delete": {
                        "TableName": tname,
                        "Key": starRefKey,
                        "ConditionExpression": "attribute_not_exists(starSk)",
                    }
                }
            ]

        try:
            _transactWithConflictRetry(txItems)
            return
        except ClientError as e:
            if not _isConditionFailure(e):
                raise
            if attempt == 2:
                if not _tbl().get_item(Key={"PK": _userPk(sub), "SK": starRefSk}).get("Item"):
                    return
                raise


def listStars(sub: str, *, limit: int = 50, cursor: str | None = None) -> dict:
    upk = _userPk(sub)
    lek = _decodeCursor(cursor, expectedPk=upk, expectedSkPrefix="STAR#")
    kwargs = {
        "KeyConditionExpression": Key("PK").eq(upk) & Key("SK").begins_with("STAR#"),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if lek:
        kwargs["ExclusiveStartKey"] = lek
    resp = _tbl().query(**kwargs)
    return {
        "items": [_normalizeStar(r) for r in (resp.get("Items") or [])],
        "nextCursor": _encodeCursor(resp.get("LastEvaluatedKey")),
    }


# --- Seen (looked-at/reviewed) markers ------------------------------------------


def markSeen(sub: str, feedId: str, itemSk: str) -> dict:
    if not ITEM_SK_RE.match(itemSk or ""):
        raise ItemNotFoundError("Invalid item key")
    feed = getFeed(sub, feedId)
    if feed is None:
        raise FeedNotFoundError("Feed not found")

    itemResp = _tbl().get_item(Key={"PK": _feedPartitionPk(sub, feedId), "SK": itemSk})
    item = itemResp.get("Item")
    if not item:
        raise ItemNotFoundError("Item not found")

    seenRefSk = f"SEENREF#{feedId}#{itemSk}"
    tname = _tableName()
    itemHash = item["itemHash"]

    for attempt in range(2):
        existingRef = _tbl().get_item(Key={"PK": _userPk(sub), "SK": seenRefSk}).get("Item")
        if existingRef and existingRef.get("seenSk"):
            existingSeen = _tbl().get_item(Key={"PK": _userPk(sub), "SK": existingRef["seenSk"]}).get("Item")
            if existingSeen:
                return _normalizeSeen(existingSeen)

        seenAt = _isoNowUtc(timespec="milliseconds")
        seenSk = f"SEEN#{seenAt}#{feedId}#{itemHash}"
        seenRow = {
            "PK": _userPk(sub),
            "SK": seenSk,
            "seenAt": seenAt,
            "feedId": feedId,
            "itemSk": itemSk,
            "itemHash": itemHash,
            "day": item["day"],
            "title": item["title"],
            "snippet": (item.get("summary") or "")[:240],
            "feedTitle": feed["title"],
            "feedKind": feed["kind"],
        }
        if item.get("link"):
            seenRow["link"] = item["link"]

        seenRefRow = {
            "PK": _userPk(sub),
            "SK": seenRefSk,
            "seenSk": seenSk,
            "feedId": feedId,
            "itemSk": itemSk,
            "seenAt": seenAt,
        }

        try:
            _transactWithConflictRetry(
                [
                    {"Put": {"TableName": tname, "Item": _serItem(seenRow)}},
                    {"Put": {"TableName": tname, "Item": _serItem(seenRefRow), "ConditionExpression": "attribute_not_exists(SK)"}},
                ]
            )
            return _normalizeSeen(seenRow)
        except ClientError as e:
            if not _isConditionFailure(e):
                raise
            existingRef = _tbl().get_item(Key={"PK": _userPk(sub), "SK": seenRefSk}).get("Item") or {}
            if existingRef.get("seenSk"):
                existingSeen = _tbl().get_item(Key={"PK": _userPk(sub), "SK": existingRef["seenSk"]}).get("Item")
                if existingSeen:
                    return _normalizeSeen(existingSeen)
            if attempt == 0:
                continue
            raise


def unmarkSeen(sub: str, feedId: str, itemSk: str) -> None:
    seenRefSk = f"SEENREF#{feedId}#{itemSk}"
    tname = _tableName()

    for attempt in range(3):
        ref = _tbl().get_item(Key={"PK": _userPk(sub), "SK": seenRefSk}).get("Item")
        if not ref:
            return

        seenRefKey = _serItem({"PK": _userPk(sub), "SK": seenRefSk})
        if ref.get("seenSk"):
            txItems = [
                {
                    "Delete": {
                        "TableName": tname,
                        "Key": seenRefKey,
                        "ConditionExpression": "seenSk = :expected",
                        "ExpressionAttributeValues": {":expected": _serVal(ref["seenSk"])},
                    }
                },
                {"Delete": {"TableName": tname, "Key": _serItem({"PK": _userPk(sub), "SK": ref["seenSk"]})}},
            ]
        else:
            txItems = [
                {
                    "Delete": {
                        "TableName": tname,
                        "Key": seenRefKey,
                        "ConditionExpression": "attribute_not_exists(seenSk)",
                    }
                }
            ]

        try:
            _transactWithConflictRetry(txItems)
            return
        except ClientError as e:
            if not _isConditionFailure(e):
                raise
            if attempt == 2:
                if not _tbl().get_item(Key={"PK": _userPk(sub), "SK": seenRefSk}).get("Item"):
                    return
                raise


def listSeen(sub: str, *, limit: int = 50, cursor: str | None = None) -> dict:
    upk = _userPk(sub)
    lek = _decodeCursor(cursor, expectedPk=upk, expectedSkPrefix="SEEN#")
    kwargs = {
        "KeyConditionExpression": Key("PK").eq(upk) & Key("SK").begins_with("SEEN#"),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if lek:
        kwargs["ExclusiveStartKey"] = lek
    resp = _tbl().query(**kwargs)
    return {
        "items": [_normalizeSeen(r) for r in (resp.get("Items") or [])],
        "nextCursor": _encodeCursor(resp.get("LastEvaluatedKey")),
    }


# --- API Keys & Ingest Rate Limiting -------------------------------------------


def listApiKeys(sub: str) -> list[dict]:
    items: list[dict] = []
    kwargs = {
        "KeyConditionExpression": Key("PK").eq(_userPk(sub)) & Key("SK").begins_with("APIKEY#"),
    }
    while True:
        resp = _tbl().query(**kwargs)
        items.extend(resp.get("Items") or [])
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek

    out = [_normalizeKey(x) for x in items]
    out.sort(key=lambda k: k["createdAt"], reverse=True)
    return out


def createApiKey(sub: str, name: str, *, maxActiveKeys: int = MAX_ACTIVE_KEYS) -> tuple[dict, str]:
    existing = [k for k in listApiKeys(sub) if not k["revoked"]]
    if len(existing) >= maxActiveKeys:
        raise TooManyKeysError(f"Maximum of {maxActiveKeys} active API keys reached")

    rawKey = f"fusf_{secrets.token_urlsafe(32)}"
    keyHash = hashlib.sha256(rawKey.encode("utf-8")).hexdigest()
    keyId = str(uuid.uuid4())
    now = _isoNowUtc()

    keyRow = {
        "PK": _userPk(sub),
        "SK": f"APIKEY#{keyId}",
        "keyId": keyId,
        "name": name,
        "prefix": rawKey[:12],
        "keyHash": keyHash,
        "createdAt": now,
        "revoked": False,
    }
    lookupRow = {
        "PK": f"APIKEYHASH#{keyHash}",
        "SK": "META",
        "sub": sub,
        "keyId": keyId,
        "keyHash": keyHash,
    }

    tname = _tableName()
    _transactWithConflictRetry(
        [
            {"Put": {"TableName": tname, "Item": _serItem(keyRow), "ConditionExpression": "attribute_not_exists(SK)"}},
            {"Put": {"TableName": tname, "Item": _serItem(lookupRow), "ConditionExpression": "attribute_not_exists(PK)"}},
        ]
    )
    return _normalizeKey(keyRow), rawKey


def revokeApiKey(sub: str, keyId: str) -> bool:
    resp = _tbl().get_item(Key={"PK": _userPk(sub), "SK": f"APIKEY#{keyId}"})
    keyRow = resp.get("Item")
    if not keyRow:
        return False

    tname = _tableName()
    txItems = [
        {
            "Update": {
                "TableName": tname,
                "Key": _serItem({"PK": _userPk(sub), "SK": f"APIKEY#{keyId}"}),
                "UpdateExpression": "SET revoked = :trueVal",
                "ConditionExpression": "attribute_exists(SK)",
                "ExpressionAttributeValues": {":trueVal": _serVal(True)},
            }
        }
    ]
    if keyRow.get("keyHash"):
        txItems.append({"Delete": {"TableName": tname, "Key": _serItem({"PK": f"APIKEYHASH#{keyRow['keyHash']}", "SK": "META"})}})

    try:
        _transactWithConflictRetry(txItems)
    except ClientError as e:
        if _isConditionFailure(e):
            return False
        raise
    return True


def resolveApiKey(rawKey: str | None) -> tuple[str, str] | None:
    if not rawKey or not isinstance(rawKey, str):
        return None
    digest = hashlib.sha256(rawKey.strip().encode("utf-8")).hexdigest()
    lookup = _tbl().get_item(Key={"PK": f"APIKEYHASH#{digest}", "SK": "META"}).get("Item")
    if not lookup:
        return None
    storedHash = str(lookup.get("keyHash") or "")
    if not hmac.compare_digest(storedHash, digest):
        return None
    sub = lookup.get("sub")
    keyId = lookup.get("keyId")
    if not sub or not keyId:
        return None

    keyRow = _tbl().get_item(Key={"PK": _userPk(sub), "SK": f"APIKEY#{keyId}"}).get("Item")
    if not keyRow or keyRow.get("revoked"):
        return None
    return sub, keyId


def touchApiKeyLastUsed(sub: str, keyId: str) -> None:
    try:
        _tbl().update_item(
            Key={"PK": _userPk(sub), "SK": f"APIKEY#{keyId}"},
            UpdateExpression="SET lastUsedAt = :now",
            ConditionExpression="attribute_exists(SK)",
            ExpressionAttributeValues={":now": _isoNowUtc()},
        )
    except ClientError as e:
        if not _isConditionFailure(e):
            raise


def checkRateLimit(keyId: str, *, limitPerMin: int = 60) -> bool:
    minute = datetime.now(timezone.utc).strftime("%Y%m%d%H%M")
    expiresAt = int(time.time()) + 300
    resp = _tbl().update_item(
        Key={"PK": f"RATELIMIT#{keyId}#{minute}", "SK": "META"},
        UpdateExpression="ADD #cnt :one SET expiresAt = if_not_exists(expiresAt, :ttl)",
        ExpressionAttributeNames={"#cnt": "count"},
        ExpressionAttributeValues=toDynamoValue({":one": 1, ":ttl": expiresAt}),
        ReturnValues="UPDATED_NEW",
    )
    count = int((resp.get("Attributes") or {}).get("count", 0))
    return count <= limitPerMin
