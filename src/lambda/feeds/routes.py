"""API Gateway HTTP API (payload 2.0) router for the isolated feeds module.

Every literal route below (matching `method` and `path` on one line) must have a
matching `aws_apigatewayv2_route` in `infra/feeds.tf` (`tests/test_route_coverage.py`
enforces this). Parameterized routes are matched after literal routes.
"""

import base64
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import re
import sys
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from common.response import jsonResponse
except ImportError:
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

from feeds import storage
from feeds.fetch import FeedDiscoveryError, FeedFetchError, fetchAndDiscoverFeed, fetchUrl
from feeds.parser import (
    FeedParseError,
    MAX_GUID_LEN,
    computeDay,
    computeItemHash,
    isValidCalendarDate,
    isValidTimezone,
    parseFeed,
    parseIsoTimestamp,
    preparePolledItems,
    safeHttpUrl,
)
from feeds.sanitize import cleanPlainText, htmlToPlainText, renderMarkupToHtml, sanitizeHtml

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_INGEST_BYTES = 256 * 1024  # 262,144 bytes
MAX_INGEST_ITEMS = 100
INITIAL_POLL_ITEMS = 100
MAX_ID_LEN = 128
MIN_SORT_ORDER = -1_000_000
MAX_SORT_ORDER = 1_000_000
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_RESERVED_FEED_IDS = {"ingest", "order", "stars", "keys", "prefs"}

_KEY_ID_RE = re.compile(r"^/feeds/keys/([^/]+)$")
_FEED_REFRESH_RE = re.compile(r"^/feeds/([^/]+)/refresh$")
_FEED_DAYS_RE = re.compile(r"^/feeds/([^/]+)/days$")
_FEED_DAY_RE = re.compile(r"^/feeds/([^/]+)/days/([^/]+)$")
_FEED_ID_RE = re.compile(r"^/feeds/([^/]+)$")


def _isoNowUtc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _getClaims(event: dict) -> dict:
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims") or {}


def _requireSub(event: dict) -> tuple[str | None, dict | None]:
    claims = _getClaims(event)
    sub = claims.get("sub")
    if not sub or not isinstance(sub, str):
        return None, jsonResponse({"error": "unauthorized"}, 401)
    return sub, None


def _getHeader(event: dict, target: str) -> str | None:
    headers = event.get("headers") or {}
    low = target.lower()
    for k, v in headers.items():
        if str(k).lower() == low:
            return v
    return None


def _decodeRawBodyBytes(event: dict, *, maxBytes: int | None = None) -> tuple[bytes | None, bool]:
    body = event.get("body")
    if body is None:
        return b"", False
    if isinstance(body, dict):
        raw = json.dumps(body).encode("utf-8")
        if maxBytes is not None and len(raw) > maxBytes:
            return None, True
        return raw, False
    if not isinstance(body, str):
        return None, False
    if event.get("isBase64Encoded"):
        if maxBytes is not None and len(body) > ((maxBytes + 2) // 3) * 4 + 16:
            return None, True
        try:
            raw = base64.b64decode(body, validate=True)
        except Exception:
            return None, False
        if maxBytes is not None and len(raw) > maxBytes:
            return None, True
        return raw, False
    if maxBytes is not None and len(body) > maxBytes:
        return None, True
    raw = body.encode("utf-8")
    if maxBytes is not None and len(raw) > maxBytes:
        return None, True
    return raw, False


def _jsonBody(event: dict) -> dict | None:
    body = event.get("body")
    if not body:
        return {}
    if isinstance(body, dict):
        return body
    rawBytes, _ = _decodeRawBodyBytes(event)
    if rawBytes is None:
        return None
    try:
        parsed = json.loads(rawBytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _parseIntParam(raw: str | None, *, default: int, minVal: int, maxVal: int) -> int:
    if raw is None or raw == "":
        return default
    try:
        val = int(raw)
    except ValueError:
        return default
    return max(minVal, min(maxVal, val))


def _slugifyTitle(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:64]
    if slug and _SLUG_RE.match(slug):
        return slug
    return f"feed-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"


def _titleFromSlug(slug: str) -> str:
    parts = [p for p in slug.split("-") if p]
    if not parts:
        return slug
    if parts[0].lower() == "mox" and len(parts) > 1:
        rest = " ".join(w.capitalize() for w in parts[1:])
        return f"Mox · {rest}"
    return " ".join(w.capitalize() for w in parts)


# --- Route handlers ------------------------------------------------------------


def _handleListFeeds(sub: str) -> dict:
    prefs = storage.getUserPrefs(sub)
    feeds = storage.listFeeds(sub, tz=prefs["tz"])
    return jsonResponse({"feeds": feeds, "tz": prefs["tz"]})


def _handleCreateFeed(event: dict, sub: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)

    prefs = storage.getUserPrefs(sub)
    kind = str(body.get("kind") or "poll").strip().lower()

    if kind == "push":
        title = str(body.get("title") or "").strip()
        if not title or len(title) > 120:
            return jsonResponse({"error": "title is required (max 120 chars)"}, 400)
        rawSlug = body.get("slug")
        slug = str(rawSlug).strip().lower() if rawSlug is not None and str(rawSlug).strip() else _slugifyTitle(title)
        if not _SLUG_RE.match(slug):
            return jsonResponse({"error": "slug must match ^[a-z0-9][a-z0-9-]{0,63}$"}, 400)
        try:
            feed = storage.createPushFeed(sub, title=title, slug=slug, tz=prefs["tz"])
        except storage.DuplicateFeedError as e:
            return jsonResponse({"error": str(e), "feedId": e.existingFeedId}, 409)
        return jsonResponse({"feed": feed, "itemsAdded": 0}, 201)

    if kind not in ("poll", ""):
        return jsonResponse({"error": "kind must be 'poll' or 'push'"}, 400)

    rawUrl = body.get("url")
    if not isinstance(rawUrl, str) or not rawUrl.strip():
        return jsonResponse({"error": "url is required"}, 400)

    try:
        finalUrl, parsed, fetchRes = fetchAndDiscoverFeed(rawUrl)
    except (FeedFetchError, FeedDiscoveryError) as e:
        return jsonResponse({"error": str(e)}, 400)

    titleOverride = str(body.get("title") or "").strip()
    title = (titleOverride or parsed.title)[:120]

    try:
        feed = storage.createPolledFeed(
            sub,
            title=title,
            kind=parsed.kind,
            url=finalUrl,
            siteUrl=parsed.siteUrl,
            etag=None,
            lastModified=None,
            tz=prefs["tz"],
        )
    except storage.DuplicateFeedError as e:
        return jsonResponse({"error": str(e), "feedId": e.existingFeedId}, 409)

    nowIso = _isoNowUtc()
    prepared = preparePolledItems(parsed, fetchedAt=nowIso, tzName=prefs["tz"], limit=INITIAL_POLL_ITEMS)
    added, _ = storage.upsertItems(sub, feed["feedId"], prepared, allowOverwrite=False)
    lastItemAt = max((it["publishedAt"] for it in prepared), default=None)
    storage.recordFetchSuccess(
        sub,
        feed["feedId"],
        etag=fetchRes.etag,
        lastModified=fetchRes.lastModified,
        lastItemAt=lastItemAt,
        notModified=False,
    )

    refreshed = storage.getFeed(sub, feed["feedId"]) or feed
    return jsonResponse({"feed": refreshed, "itemsAdded": added}, 201)


def _handleReorderFeeds(event: dict, sub: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    feedIds = body.get("feedIds")
    if not isinstance(feedIds, list) or not feedIds or not all(isinstance(x, str) and x.strip() for x in feedIds):
        return jsonResponse({"error": "feedIds must be a non-empty list of strings"}, 400)
    cleaned = [x.strip() for x in feedIds]
    if any(len(x) > MAX_ID_LEN for x in cleaned):
        return jsonResponse({"error": f"feedId must be at most {MAX_ID_LEN} characters"}, 400)
    if len(set(cleaned)) != len(cleaned):
        return jsonResponse({"error": "feedIds must not contain duplicates"}, 400)
    try:
        order = storage.reorderFeeds(sub, cleaned)
    except storage.FeedNotFoundError as e:
        return jsonResponse({"error": str(e)}, 404)
    return jsonResponse({"feedIds": order})


def _handleUpdateFeed(event: dict, sub: str, feedId: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)

    title = None
    if "title" in body:
        t = str(body.get("title") or "").strip()
        if not t or len(t) > 120:
            return jsonResponse({"error": "title must be 1–120 characters"}, 400)
        title = t

    pinned = None
    if "pinned" in body:
        if not isinstance(body["pinned"], bool):
            return jsonResponse({"error": "pinned must be a boolean"}, 400)
        pinned = body["pinned"]

    sortOrder = None
    if "sortOrder" in body:
        so = body["sortOrder"]
        if isinstance(so, bool) or not isinstance(so, int):
            return jsonResponse({"error": "sortOrder must be an integer"}, 400)
        if so < MIN_SORT_ORDER or so > MAX_SORT_ORDER:
            return jsonResponse({"error": f"sortOrder must be between {MIN_SORT_ORDER} and {MAX_SORT_ORDER}"}, 400)
        sortOrder = so

    updated = storage.updateFeed(sub, feedId, title=title, pinned=pinned, sortOrder=sortOrder)
    if updated is None:
        return jsonResponse({"error": "Feed not found"}, 404)
    return jsonResponse({"feed": updated})


def _handleDeleteFeed(sub: str, feedId: str) -> dict:
    deleted = storage.deleteFeed(sub, feedId)
    if not deleted:
        return jsonResponse({"error": "Feed not found"}, 404)
    return jsonResponse({"deleted": True, "feedId": feedId})


def _handleRefreshFeed(sub: str, feedId: str) -> dict:
    feed = storage.getFeed(sub, feedId)
    if feed is None:
        return jsonResponse({"error": "Feed not found"}, 404)
    if feed["kind"] == "push" or not feed.get("url"):
        return jsonResponse({"error": "Push feeds cannot be refreshed"}, 400)

    failCount = int(feed.get("failCount", 0))
    try:
        res = fetchUrl(feed["url"], etag=feed.get("etag"), lastModified=feed.get("lastModified"))
    except FeedFetchError as e:
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return jsonResponse({"error": str(e)}, 502)

    if res.notModified:
        storage.recordFetchSuccess(
            sub,
            feedId,
            etag=res.etag,
            lastModified=res.lastModified,
            lastItemAt=None,
            currentLastItemAt=feed.get("lastItemAt"),
            notModified=True,
        )
        updatedFeed = storage.getFeed(sub, feedId) or feed
        return jsonResponse({"feed": updatedFeed, "notModified": True, "itemsAdded": 0})

    try:
        parsed = parseFeed(res.body, contentType=res.contentType, url=res.url)
    except FeedParseError as e:
        storage.recordFetchFailure(sub, feedId, errorMessage=str(e), failCount=failCount + 1)
        return jsonResponse({"error": str(e)}, 400)

    nowIso = _isoNowUtc()
    prepared = preparePolledItems(
        parsed,
        fetchedAt=nowIso,
        tzName=feed.get("tz") or "America/Los_Angeles",
        limit=INITIAL_POLL_ITEMS,
    )
    added, _ = storage.upsertItems(sub, feedId, prepared, allowOverwrite=False)
    lastItemAt = max((it["publishedAt"] for it in prepared), default=None)
    storage.recordFetchSuccess(
        sub,
        feedId,
        etag=res.etag,
        lastModified=res.lastModified,
        lastItemAt=lastItemAt,
        currentLastItemAt=feed.get("lastItemAt"),
        notModified=False,
    )
    updatedFeed = storage.getFeed(sub, feedId) or feed
    return jsonResponse({"feed": updatedFeed, "notModified": False, "itemsAdded": added})


def _handleListDays(event: dict, sub: str, feedId: str) -> dict:
    qs = event.get("queryStringParameters") or {}
    limit = _parseIntParam(qs.get("limit"), default=60, minVal=1, maxVal=100)
    cursor = qs.get("cursor")
    try:
        page = storage.listDays(sub, feedId, limit=limit, cursor=cursor)
    except storage.FeedNotFoundError:
        return jsonResponse({"error": "Feed not found"}, 404)
    except storage.InvalidCursorError as e:
        return jsonResponse({"error": str(e)}, 400)
    return jsonResponse(page)


def _handleGetDayItems(sub: str, feedId: str, day: str) -> dict:
    if not isValidCalendarDate(day):
        return jsonResponse({"error": "day must be a valid YYYY-MM-DD date"}, 400)
    try:
        feed, items = storage.listDayItems(sub, feedId, day)
    except storage.FeedNotFoundError:
        return jsonResponse({"error": "Feed not found"}, 404)
    return jsonResponse({"feed": feed, "day": day, "items": items})


def _handleListStars(event: dict, sub: str) -> dict:
    qs = event.get("queryStringParameters") or {}
    limit = _parseIntParam(qs.get("limit"), default=50, minVal=1, maxVal=100)
    cursor = qs.get("cursor")
    try:
        page = storage.listStars(sub, limit=limit, cursor=cursor)
    except storage.InvalidCursorError as e:
        return jsonResponse({"error": str(e)}, 400)
    return jsonResponse(page)


def _handleStarItem(event: dict, sub: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    feedId = str(body.get("feedId") or "").strip()
    itemSk = str(body.get("itemSk") or "").strip()
    if not feedId or not itemSk:
        return jsonResponse({"error": "feedId and itemSk are required"}, 400)
    if len(feedId) > MAX_ID_LEN:
        return jsonResponse({"error": "Invalid feedId"}, 400)
    if not storage.ITEM_SK_RE.match(itemSk):
        return jsonResponse({"error": "Invalid itemSk"}, 400)
    try:
        star = storage.starItem(sub, feedId, itemSk)
    except (storage.FeedNotFoundError, storage.ItemNotFoundError) as e:
        return jsonResponse({"error": str(e)}, 404)
    return jsonResponse({"starred": True, "star": star})


def _handleUnstarItem(event: dict, sub: str) -> dict:
    qs = event.get("queryStringParameters") or {}
    feedId = str(qs.get("feedId") or "").strip()
    itemSk = str(qs.get("itemSk") or "").strip()
    if not feedId or not itemSk:
        body = _jsonBody(event)
        if body is None:
            return jsonResponse({"error": "Invalid JSON body"}, 400)
        feedId = feedId or str(body.get("feedId") or "").strip()
        itemSk = itemSk or str(body.get("itemSk") or "").strip()
    if not feedId or not itemSk:
        return jsonResponse({"error": "feedId and itemSk are required"}, 400)
    if len(feedId) > MAX_ID_LEN:
        return jsonResponse({"error": "Invalid feedId"}, 400)
    if not storage.ITEM_SK_RE.match(itemSk):
        return jsonResponse({"error": "Invalid itemSk"}, 400)
    storage.unstarItem(sub, feedId, itemSk)
    return jsonResponse({"starred": False})


def _handleListKeys(sub: str) -> dict:
    return jsonResponse({"keys": storage.listApiKeys(sub)})


def _handleCreateKey(event: dict, sub: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    name = str(body.get("name") or "").strip()
    if not name or len(name) > 80:
        return jsonResponse({"error": "name is required (max 80 chars)"}, 400)
    try:
        keyMeta, rawKey = storage.createApiKey(sub, name)
    except storage.TooManyKeysError as e:
        return jsonResponse({"error": str(e)}, 400)
    return jsonResponse({"key": keyMeta, "rawKey": rawKey}, 201)


def _handleRevokeKey(sub: str, keyId: str) -> dict:
    revoked = storage.revokeApiKey(sub, keyId)
    if not revoked:
        return jsonResponse({"error": "API key not found"}, 404)
    return jsonResponse({"revoked": True, "keyId": keyId})


def _handleGetPrefs(sub: str) -> dict:
    return jsonResponse(storage.getUserPrefs(sub))


def _handlePutPrefs(event: dict, sub: str) -> dict:
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    tz = str(body.get("tz") or "").strip()
    if not isValidTimezone(tz):
        return jsonResponse({"error": "Invalid IANA timezone"}, 400)
    return jsonResponse(storage.setUserPrefs(sub, tz))


def _prepareIngestItem(raw: dict, *, feedFormat: str, fallbackDate: str | None, nowIso: str, tzName: str) -> tuple[dict | None, str | None]:
    if not isinstance(raw, dict):
        return None, "Each item must be an object"

    title = cleanPlainText(str(raw.get("title") or ""), 300)
    if not title:
        return None, "Each item requires a non-empty title"

    rawLink = raw.get("link")
    link = None
    if rawLink is not None and str(rawLink).strip():
        link = safeHttpUrl(str(rawLink))
        if link is None:
            return None, "Item link must be a valid http or https URL"

    rawPub = raw.get("publishedAt")
    if rawPub is not None and str(rawPub).strip():
        pubStr = str(rawPub).strip()
        if not isValidCalendarDate(pubStr) and parseIsoTimestamp(pubStr) is None:
            return None, "Item publishedAt must be a valid ISO 8601 timestamp"

    guid = str(raw.get("guid") or "").strip()
    if len(guid) > MAX_GUID_LEN:
        return None, f"Item guid must be at most {MAX_GUID_LEN} characters"

    rawHtml = raw.get("contentHtml")
    rawMrkdwn = raw.get("contentMrkdwn")
    rawMd = raw.get("contentMarkdown")
    rawSummary = raw.get("summary")

    if isinstance(rawHtml, str) and rawHtml.strip():
        contentHtml = sanitizeHtml(rawHtml)
    elif isinstance(rawMrkdwn, str) and rawMrkdwn.strip():
        contentHtml = renderMarkupToHtml(rawMrkdwn, fmt="mrkdwn")
    elif isinstance(rawMd, str) and rawMd.strip():
        contentHtml = renderMarkupToHtml(rawMd, fmt=feedFormat)
    elif isinstance(rawSummary, str) and rawSummary.strip():
        contentHtml = renderMarkupToHtml(rawSummary, fmt=feedFormat)
    else:
        contentHtml = ""

    if isinstance(rawSummary, str) and rawSummary.strip():
        summary = htmlToPlainText(renderMarkupToHtml(rawSummary, fmt=feedFormat))
    else:
        summary = htmlToPlainText(contentHtml)
    author = cleanPlainText(str(raw.get("author") or ""), 120) or None

    hasExplicitDate = (rawPub is not None and bool(str(rawPub).strip())) or bool(fallbackDate)
    day, normPub = computeDay(
        str(rawPub) if rawPub is not None and str(rawPub).strip() else None,
        fallbackDate,
        nowIso,
        tzName,
    )
    itemHash = computeItemHash(
        guid,
        link,
        title,
        normPub if (not guid and not link and hasExplicitDate) else None,
        summary,
    )
    # Note: when guid is supplied (standard for Mox/backfill), computeItemHash uses guid only
    # so fixing/re-ingesting with the same guid overwrites in place even if publishedAt changes.

    return {
        "itemHash": itemHash,
        "day": day,
        "title": title,
        "link": link,
        "summary": summary,
        "contentHtml": contentHtml,
        "author": author,
        "publishedAt": normPub,
        "fetchedAt": nowIso,
        "guid": guid or None,
    }, None


def _handleIngest(event: dict) -> dict:
    rawBytes, tooLarge = _decodeRawBodyBytes(event, maxBytes=MAX_INGEST_BYTES)
    if tooLarge:
        return jsonResponse({"error": "Payload too large (max 256 KB)"}, 413)
    if rawBytes is None:
        return jsonResponse({"error": "Invalid request encoding"}, 400)

    apiKey = _getHeader(event, "X-Api-Key")
    resolved = storage.resolveApiKey(apiKey)
    if resolved is None:
        return jsonResponse({"error": "Invalid or revoked API key"}, 401)
    sub, keyId = resolved

    if not storage.checkRateLimit(keyId):
        return jsonResponse({"error": "Rate limit exceeded"}, 429)

    try:
        body = json.loads(rawBytes.decode("utf-8")) if rawBytes else {}
    except (UnicodeDecodeError, ValueError):
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    if not isinstance(body, dict):
        return jsonResponse({"error": "Request body must be a JSON object"}, 400)

    slug = str(body.get("feed") or "").strip().lower()
    if not _SLUG_RE.match(slug):
        return jsonResponse({"error": "feed slug must match ^[a-z0-9][a-z0-9-]{0,63}$"}, 400)

    fallbackDate = body.get("date")
    if fallbackDate is not None:
        fallbackDate = str(fallbackDate).strip()
        if fallbackDate and not isValidCalendarDate(fallbackDate):
            return jsonResponse({"error": "date must be a valid YYYY-MM-DD date"}, 400)
        if not fallbackDate:
            fallbackDate = None

    feedFormat = str(body.get("format") or "auto").strip().lower()
    if feedFormat not in ("auto", "mrkdwn", "markdown", "html"):
        return jsonResponse({"error": "format must be auto, mrkdwn, markdown, or html"}, 400)

    rawItems = body.get("items")
    if not isinstance(rawItems, list) or not rawItems:
        return jsonResponse({"error": "items must be a non-empty array"}, 400)
    if len(rawItems) > MAX_INGEST_ITEMS:
        return jsonResponse({"error": f"items exceeds max of {MAX_INGEST_ITEMS} per request"}, 400)

    prefs = storage.getUserPrefs(sub)
    nowIso = _isoNowUtc()
    prepared: list[dict] = []
    for raw in rawItems:
        item, err = _prepareIngestItem(
            raw,
            feedFormat=feedFormat,
            fallbackDate=fallbackDate,
            nowIso=nowIso,
            tzName=prefs["tz"],
        )
        if err:
            return jsonResponse({"error": err}, 400)
        prepared.append(item)

    feedTitle = str(body.get("title") or "").strip()[:120] or _titleFromSlug(slug)
    feed, created = storage.getOrCreatePushFeedBySlug(sub, slug=slug, title=feedTitle, tz=prefs["tz"])
    added, updated = storage.upsertItems(sub, feed["feedId"], prepared, allowOverwrite=True)

    lastItemAt = max((it["publishedAt"] for it in prepared), default=nowIso)
    storage.touchPushFeedActivity(
        sub,
        feed["feedId"],
        lastItemAt=lastItemAt,
        currentLastItemAt=feed.get("lastItemAt"),
    )
    storage.touchApiKeyLastUsed(sub, keyId)

    return jsonResponse(
        {
            "feedId": feed["feedId"],
            "slug": slug,
            "created": created,
            "itemsAdded": added,
            "itemsUpdated": updated,
        }
    )


def route(event: dict) -> dict:
    path = event.get("rawPath", "")
    if not path:
        path = event.get("requestContext", {}).get("http", {}).get("path", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    # Machine-to-machine ingest uses X-Api-Key rather than Cognito JWT.
    if method == "POST" and path == "/feeds/ingest":
        return _handleIngest(event)

    sub, authErr = _requireSub(event)
    if authErr:
        return authErr

    # Literal routes (each method+path on one line for tests/test_route_coverage.py)
    if method == "GET" and path == "/feeds":
        return _handleListFeeds(sub)
    if method == "POST" and path == "/feeds":
        return _handleCreateFeed(event, sub)
    if method == "PUT" and path == "/feeds/order":
        return _handleReorderFeeds(event, sub)
    if method == "GET" and path == "/feeds/stars":
        return _handleListStars(event, sub)
    if method == "PUT" and path == "/feeds/stars":
        return _handleStarItem(event, sub)
    if method == "DELETE" and path == "/feeds/stars":
        return _handleUnstarItem(event, sub)
    if method == "GET" and path == "/feeds/keys":
        return _handleListKeys(sub)
    if method == "POST" and path == "/feeds/keys":
        return _handleCreateKey(event, sub)
    if method == "GET" and path == "/feeds/prefs":
        return _handleGetPrefs(sub)
    if method == "PUT" and path == "/feeds/prefs":
        return _handlePutPrefs(event, sub)

    pathParams = event.get("pathParameters") or {}

    mKey = _KEY_ID_RE.match(path)
    if mKey and method == "DELETE":
        keyId = unquote(pathParams.get("keyId") or mKey.group(1))
        if len(keyId) > MAX_ID_LEN:
            return jsonResponse({"error": "not found"}, 404)
        return _handleRevokeKey(sub, keyId)

    mRefresh = _FEED_REFRESH_RE.match(path)
    if mRefresh and method == "POST":
        feedId = unquote(pathParams.get("id") or mRefresh.group(1))
        if feedId in _RESERVED_FEED_IDS or len(feedId) > MAX_ID_LEN:
            return jsonResponse({"error": "not found"}, 404)
        return _handleRefreshFeed(sub, feedId)

    mDay = _FEED_DAY_RE.match(path)
    if mDay and method == "GET":
        feedId = unquote(pathParams.get("id") or mDay.group(1))
        day = unquote(pathParams.get("day") or mDay.group(2))
        if feedId in _RESERVED_FEED_IDS or len(feedId) > MAX_ID_LEN:
            return jsonResponse({"error": "not found"}, 404)
        return _handleGetDayItems(sub, feedId, day)

    mDays = _FEED_DAYS_RE.match(path)
    if mDays and method == "GET":
        feedId = unquote(pathParams.get("id") or mDays.group(1))
        if feedId in _RESERVED_FEED_IDS or len(feedId) > MAX_ID_LEN:
            return jsonResponse({"error": "not found"}, 404)
        return _handleListDays(event, sub, feedId)

    mFeed = _FEED_ID_RE.match(path)
    if mFeed:
        feedId = unquote(pathParams.get("id") or mFeed.group(1))
        if feedId in _RESERVED_FEED_IDS or len(feedId) > MAX_ID_LEN:
            return jsonResponse({"error": "not found"}, 404)
        if method == "PUT":
            return _handleUpdateFeed(event, sub, feedId)
        if method == "DELETE":
            return _handleDeleteFeed(sub, feedId)

    return jsonResponse({"error": "not found"}, 404)


def handler(event, context):
    return route(event)
