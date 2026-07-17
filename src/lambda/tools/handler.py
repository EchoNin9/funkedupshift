"""
Tools platform Lambda: URL shortener mint + metadata API.

Isolated by design from the finance/app Lambda: own IAM role, own DynamoDB
table (fus-tools), own zip. Public anonymous-adjacent tool traffic must
never share execution context or keyspace with personal-finance data — see
docs/tools-platform-phase1-brief.md, section 5 (guardrails).

Resolution (the hot path — fus.fyi/<code> -> redirect) happens entirely at
the CloudFront edge via a CloudFront Function reading the KeyValueStore.
This Lambda is only invoked for minting (POST /s), metadata (GET /s/{code}),
listing a caller's own links (GET /s), and creator-only delete/expiry-edit
(DELETE /s/{code}, PATCH /s/{code}) — all behind the existing Cognito JWT
authorizer.

Write flow: mint -> DynamoDB PutItem (source of truth, conditional on the
code being unused) -> CloudFront KeyValueStore PutKey (read-optimized edge
projection). The two are kept reconcilable: DynamoDB is authoritative, so a
KVS write failure after a successful DynamoDB write can be repaired later by
a backfill sweep over the table (not built in phase 1) rather than losing
the mint.

Expiry: every mint stamps expiresAt = now + LINK_TTL_DAYS (no mint-time
override — see docs brief). DynamoDB TTL (enabled on expiresAt in
infra/tools.tf) reclaims expired rows from the table on its own schedule.
Edge enforcement is independent of that: the KVS value is JSON
`{"u": <url>, "e": <epochSeconds>}` and shortener-redirect.js treats
e <= now as a miss regardless of whether DynamoDB has gotten around to
deleting the row yet.
"""
import base64
import json
import logging
import os
import secrets
import string
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from botocore.exceptions import ClientError  # noqa: E402

try:
    from common.response import jsonResponse
except ImportError:
    # Fallback if import fails (mirrors api/handler.py's defensive import)
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TOOLS_TABLE_NAME = os.environ.get("TOOLS_TABLE_NAME", "")
KVS_ARN = os.environ.get("KVS_ARN", "")
SHORT_DOMAIN = os.environ.get("SHORT_DOMAIN", "fus.fyi")
LINK_TTL_DAYS = int(os.environ.get("LINK_TTL_DAYS", "30"))

# Domains that resolve short codes themselves — a short URL that targets one
# of these would create a redirect loop at the edge. Codes are global and
# domain-agnostic (see brief section 4.5), so this check is host-based, not
# per-brand.
LOOP_DOMAINS = ("fus.fyi", "e9.cx")

CODE_LENGTH = 7
CODE_ALPHABET = string.ascii_letters + string.digits  # base62
MAX_URL_LENGTH = 2048
MAX_MINT_ATTEMPTS = 5

DEFAULT_LIST_LIMIT = 20
MAX_LIST_LIMIT = 100

_dynamodb = None
_kvs = None


def _ddb():
    """Cached DynamoDB client."""
    global _dynamodb
    if _dynamodb is None:
        import boto3
        _dynamodb = boto3.client("dynamodb")
    return _dynamodb


def _kvsClient():
    """Cached CloudFront KeyValueStore data-plane client."""
    global _kvs
    if _kvs is None:
        import boto3
        _kvs = boto3.client("cloudfront-keyvaluestore")
    return _kvs


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _nowEpoch():
    return int(time.time())


def _generateCode():
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _encodeCursor(lastEvaluatedKey):
    """base64(JSON(LastEvaluatedKey)) — opaque to the client, round-tripped
    straight back to DynamoDB as ExclusiveStartKey on the next page."""
    raw = json.dumps(lastEvaluatedKey).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decodeCursor(cursor):
    """Returns the decoded ExclusiveStartKey dict, or raises ValueError on garbage input."""
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii"))
        key = json.loads(raw)
    except Exception as e:
        raise ValueError("invalid cursor") from e
    if not isinstance(key, dict):
        raise ValueError("invalid cursor")
    return key


def _clampLimit(raw):
    """Non-numeric or out-of-range -> clamp to default/max rather than error (see brief)."""
    try:
        limit = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LIST_LIMIT
    if limit <= 0:
        return DEFAULT_LIST_LIMIT
    return min(limit, MAX_LIST_LIMIT)


def _validateUrl(raw):
    """Validate a candidate mint target. Returns (url, error) — error is None if valid."""
    if not raw or not isinstance(raw, str):
        return None, "url is required"
    url = raw.strip()
    if not url:
        return None, "url is required"
    if len(url) > MAX_URL_LENGTH:
        return None, f"url exceeds {MAX_URL_LENGTH} characters"
    try:
        parsed = urlparse(url)
    except Exception:
        return None, "url could not be parsed"
    if parsed.scheme not in ("http", "https"):
        return None, "url must start with http:// or https://"
    if not parsed.netloc:
        return None, "url is missing a host"
    host = (parsed.hostname or "").lower()
    if host in LOOP_DOMAINS or any(host.endswith("." + d) for d in LOOP_DOMAINS):
        return None, "url must not target a short-link domain (would create a redirect loop)"
    return url, None


def _getClaims(event):
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {}) or {}


def _getSub(event):
    claims = _getClaims(event)
    return claims.get("sub") or claims.get("cognito:username") or claims.get("username") or ""


def _getCreatedHost(event):
    """Best-effort brand/host metadata for analytics only — never affects resolution."""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    return headers.get("origin") or headers.get("referer") or headers.get("host") or ""


def _mintCode(url, created_by, created_host, expires_at, created_at):
    """Write a new DynamoDB item with a fresh random code, retrying on collision.

    Returns the code, or None if MAX_MINT_ATTEMPTS collisions were hit.
    """
    client = _ddb()
    for _ in range(MAX_MINT_ATTEMPTS):
        code = _generateCode()
        item = {
            "code": {"S": code},
            "url": {"S": url},
            "createdBy": {"S": created_by or ""},
            "createdHost": {"S": created_host or ""},
            "createdAt": {"S": created_at},
            "expiresAt": {"N": str(expires_at)},
        }
        try:
            client.put_item(
                TableName=TOOLS_TABLE_NAME,
                Item=item,
                ConditionExpression="attribute_not_exists(code)",
            )
            return code
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                continue
            raise
    return None


def _putKvsKey(code, url, expires_at):
    """Upsert code -> {"u": url, "e": expiresAt} in the KeyValueStore using the
    required ETag If-Match flow. shortener-redirect.js parses this JSON at
    the edge and treats e <= now as a miss (legacy plain-string values from
    before expiry existed are tolerated there as non-expiring)."""
    client = _kvsClient()
    desc = client.describe_key_value_store(KvsARN=KVS_ARN)
    value = json.dumps({"u": url, "e": expires_at})
    client.put_key(Key=code, Value=value, KvsARN=KVS_ARN, IfMatch=desc["ETag"])


def _deleteKvsKey(code):
    """Remove a code from the KeyValueStore using the required ETag If-Match flow."""
    client = _kvsClient()
    desc = client.describe_key_value_store(KvsARN=KVS_ARN)
    client.delete_key(Key=code, KvsARN=KVS_ARN, IfMatch=desc["ETag"])


def mintShortLink(event):
    try:
        body = json.loads(event.get("body") or "{}")
    except (json.JSONDecodeError, TypeError):
        return jsonResponse({"error": "Invalid JSON body"}, 400)

    if not isinstance(body, dict):
        return jsonResponse({"error": "Invalid JSON body"}, 400)

    url, err = _validateUrl(body.get("url"))
    if err:
        return jsonResponse({"error": err}, 400)

    created_by = _getSub(event)
    created_host = _getCreatedHost(event)
    created_at = _now()
    expires_at = _nowEpoch() + LINK_TTL_DAYS * 86400

    code = _mintCode(url, created_by, created_host, expires_at, created_at)
    if not code:
        return jsonResponse(
            {"error": "Could not generate a unique short code after several attempts; please try again"},
            500,
        )

    try:
        _putKvsKey(code, url, expires_at)
    except Exception as e:
        logger.error("KVS write failed for code=%s: %s", code, e)
        # DynamoDB is the source of truth and already has this item — it is
        # reconcilable by a later backfill sweep. Surface 500 so the client
        # knows the short link isn't resolvable at the edge yet.
        return jsonResponse(
            {"error": "Short link saved but not yet resolvable; please retry"},
            500,
        )

    return jsonResponse(
        {
            "code": code,
            "url": url,
            "shortUrl": f"https://{SHORT_DOMAIN}/{code}",
            "createdAt": created_at,
            "expiresAt": expires_at,
        },
        200,
    )


def getShortLink(event, code):
    if not code:
        return jsonResponse({"error": "code is required"}, 400)

    client = _ddb()
    resp = client.get_item(TableName=TOOLS_TABLE_NAME, Key={"code": {"S": code}})
    item = resp.get("Item")
    if not item:
        return jsonResponse({"error": "Not found"}, 404)

    return jsonResponse(
        {
            "code": item.get("code", {}).get("S", code),
            "url": item.get("url", {}).get("S", ""),
            "createdBy": item.get("createdBy", {}).get("S", ""),
            "createdHost": item.get("createdHost", {}).get("S", ""),
            "createdAt": item.get("createdAt", {}).get("S", ""),
            "expiresAt": int(item.get("expiresAt", {}).get("N", "0")),
            "shortUrl": f"https://{SHORT_DOMAIN}/{code}",
        },
        200,
    )


def listShortLinks(event):
    """GET /s — the caller's own links, newest first, paginated via byCreator."""
    sub = _getSub(event)
    qs = event.get("queryStringParameters") or {}

    limit = _clampLimit(qs.get("limit"))

    exclusive_start_key = None
    cursor = qs.get("cursor")
    if cursor:
        try:
            exclusive_start_key = _decodeCursor(cursor)
        except ValueError:
            return jsonResponse({"error": "Invalid cursor"}, 400)

    client = _ddb()
    kwargs = {
        "TableName": TOOLS_TABLE_NAME,
        "IndexName": "byCreator",
        "KeyConditionExpression": "createdBy = :sub",
        # Filtered (expired-but-not-yet-TTL-deleted) rows still consume the
        # page's Limit — acceptable per the brief; a page can come back
        # short even when more live links exist beyond the cursor.
        "FilterExpression": "expiresAt > :now",
        "ExpressionAttributeValues": {
            ":sub": {"S": sub},
            ":now": {"N": str(_nowEpoch())},
        },
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if exclusive_start_key:
        kwargs["ExclusiveStartKey"] = exclusive_start_key

    resp = client.query(**kwargs)

    items = [
        {
            "code": item.get("code", {}).get("S", ""),
            "url": item.get("url", {}).get("S", ""),
            "shortUrl": f"https://{SHORT_DOMAIN}/{item.get('code', {}).get('S', '')}",
            "createdAt": item.get("createdAt", {}).get("S", ""),
            "expiresAt": int(item.get("expiresAt", {}).get("N", "0")),
        }
        for item in resp.get("Items", [])
    ]

    lastEvaluatedKey = resp.get("LastEvaluatedKey")
    nextCursor = _encodeCursor(lastEvaluatedKey) if lastEvaluatedKey else None

    return jsonResponse({"items": items, "nextCursor": nextCursor}, 200)


def deleteShortLink(event, code):
    """DELETE /s/{code} — creator only. KVS-first: a KVS failure leaves the
    DynamoDB row (and thus the link) intact and the delete retryable."""
    if not code:
        return jsonResponse({"error": "code is required"}, 400)

    client = _ddb()
    resp = client.get_item(TableName=TOOLS_TABLE_NAME, Key={"code": {"S": code}})
    item = resp.get("Item")
    if not item:
        return jsonResponse({"error": "Not found"}, 404)

    if item.get("createdBy", {}).get("S", "") != _getSub(event):
        # Do not leak the target url or any other item detail to a non-owner.
        return jsonResponse({"error": "Forbidden"}, 403)

    try:
        _deleteKvsKey(code)
    except Exception as e:
        logger.error("KVS delete failed for code=%s: %s", code, e)
        return jsonResponse({"error": "Could not delete short link; please retry"}, 500)

    client.delete_item(TableName=TOOLS_TABLE_NAME, Key={"code": {"S": code}})
    return jsonResponse({"code": code, "deleted": True}, 200)


def patchShortLinkExpiry(event, code):
    """PATCH /s/{code} — creator only. Body: {"expiresAt": <epochSeconds>}, must be
    strictly in the future. DynamoDB is updated first (source of truth), then
    the KVS JSON value is rewritten with the new expiry."""
    if not code:
        return jsonResponse({"error": "code is required"}, 400)

    try:
        body = json.loads(event.get("body") or "{}")
    except (json.JSONDecodeError, TypeError):
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    if not isinstance(body, dict):
        return jsonResponse({"error": "Invalid JSON body"}, 400)

    expires_at = body.get("expiresAt")
    if not isinstance(expires_at, (int, float)) or isinstance(expires_at, bool):
        return jsonResponse({"error": "expiresAt must be a number"}, 400)
    expires_at = int(expires_at)
    if expires_at <= _nowEpoch():
        return jsonResponse({"error": "expiresAt must be in the future"}, 400)

    client = _ddb()
    resp = client.get_item(TableName=TOOLS_TABLE_NAME, Key={"code": {"S": code}})
    item = resp.get("Item")
    if not item:
        return jsonResponse({"error": "Not found"}, 404)

    if item.get("createdBy", {}).get("S", "") != _getSub(event):
        # Do not leak the target url or any other item detail to a non-owner.
        return jsonResponse({"error": "Forbidden"}, 403)

    url = item.get("url", {}).get("S", "")

    client.update_item(
        TableName=TOOLS_TABLE_NAME,
        Key={"code": {"S": code}},
        UpdateExpression="SET expiresAt = :e",
        ExpressionAttributeValues={":e": {"N": str(expires_at)}},
    )

    try:
        _putKvsKey(code, url, expires_at)
    except Exception as e:
        logger.error("KVS write failed for code=%s during expiry update: %s", code, e)
        return jsonResponse(
            {"error": "Expiry updated but not yet resolvable at the edge; please retry"},
            500,
        )

    return jsonResponse(
        {
            "code": code,
            "url": url,
            "shortUrl": f"https://{SHORT_DOMAIN}/{code}",
            "createdAt": item.get("createdAt", {}).get("S", ""),
            "expiresAt": expires_at,
        },
        200,
    )


def handler(event, context):
    """Route request by path; return JSON with CORS headers."""
    try:
        path = event.get("rawPath", "")
        if not path:
            path = event.get("requestContext", {}).get("http", {}).get("path", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

        logger.info("path=%s, method=%s", path, method)

        # NOTE: every literal route below must also exist as an
        # aws_apigatewayv2_route in infra/tools.tf — a handler route with no
        # gateway route 404s at the gateway without CORS headers.
        # tests/test_route_coverage.py guards this.
        if method == "POST" and path == "/s":
            return mintShortLink(event)
        if method == "GET" and path == "/s":
            return listShortLinks(event)
        if method == "GET" and path.startswith("/s/"):
            code = path[len("/s/"):]
            return getShortLink(event, code)
        if method == "DELETE" and path.startswith("/s/"):
            code = path[len("/s/"):]
            return deleteShortLink(event, code)
        if method == "PATCH" and path.startswith("/s/"):
            code = path[len("/s/"):]
            return patchShortLinkExpiry(event, code)

        return jsonResponse({"error": "Not found"}, 404)
    except Exception as e:
        logger.exception("tools handler error: %s", e)
        return jsonResponse({"error": "Internal server error"}, 500)
