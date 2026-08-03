"""
API Gateway HTTP API (payload 2.0) dispatch for the social scheduling module
(phase 4). Wraps the phase-1/2 action functions in social/handler.py (the
single source of business logic — validation, DDB writes, EventBridge
Scheduler calls) so both the direct-invoke path (still used by
scripts/social_schedule.py and scripts/social_invoke_bluesky.py, and
unmodified by this file) and this HTTP path share identical behaviour.

Every route requires the admin Cognito group. Group membership is read
ONLY from the JWT claims delivered by aws_apigatewayv2_authorizer.cognito
(see infra/social.tf) — never from a lookup against the main app's
DynamoDB table, since the social Lambda's IAM role has no access to it by
design (see infra/social.tf's isolation comment).

NOTE: every literal method/path dispatch below (`method == ...` and
`path == ...` on the same line) must also exist as an aws_apigatewayv2_route
in infra/social.tf.
tests/test_route_coverage.py guards this (see HANDLERS in that file) for
literal routes; the {postId}-parameterised routes below are dispatched via
path-splitting (same convention as api/handler.py and tools/handler.py) and
are NOT statically extractable, so they're exempt from that check the same
way every other parameterised route in this codebase is.
"""
import json
import logging
import re
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from common.response import jsonResponse
except ImportError:
    # Fallback if import fails (mirrors api/handler.py and tools/handler.py)
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

from social import handler as directHandler
from social import media, secrets, storage
from social.publisher import processPost

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_ALLOWED_MEDIA_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "video/mp4"}
MAX_UPLOAD_BYTES = 100_000_000
_FILENAME_DISALLOWED_RE = re.compile(r"[^A-Za-z0-9._-]+")
PRESIGN_EXPIRES_IN = 3600


# --- auth ----------------------------------------------------------------------


def _getClaims(event):
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims") or {}


def _parseGroups(rawGroups):
    """cognito:groups arrives as either a list, or a string. The string form
    varies by source: a JSON array `["admin","manager"]`, or Cognito's own
    stringification of a Python-style list `[admin manager]` (SPACE, not
    comma, separated -- api/handler.py's getUserInfo only handles the
    comma-separated case, so it is NOT reused verbatim here; see brief)."""
    if isinstance(rawGroups, list):
        return [str(g) for g in rawGroups]
    if not isinstance(rawGroups, str) or not rawGroups.strip():
        return []

    raw = rawGroups.strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(g) for g in parsed]
        return [str(parsed)]
    except (ValueError, TypeError):
        pass

    stripped = raw.strip("[]")
    if not stripped:
        return []
    parts = stripped.split(",") if "," in stripped else stripped.split()
    return [p.strip().strip("\"'") for p in parts if p.strip().strip("\"'")]


def _requireAdmin(event):
    """Returns (claims, None) on success, or (None, errorResponse). 401 when
    the JWT claims are missing/empty (shouldn't happen behind the JWT
    authorizer, but defend anyway); 403 when the caller isn't in `admin`."""
    claims = _getClaims(event)
    if not claims:
        return None, jsonResponse({"error": "unauthorized"}, 401)
    groups = _parseGroups(claims.get("cognito:groups"))
    if "admin" not in groups:
        return None, jsonResponse({"error": "forbidden"}, 403)
    return claims, None


# --- helpers ---------------------------------------------------------------------


def _jsonBody(event):
    """Returns {} for an empty body, a dict for valid JSON, or None for
    invalid JSON (callers must check for None and 400 on it)."""
    body = event.get("body")
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        import base64
        try:
            body = base64.b64decode(body).decode("utf-8")
        except Exception:
            return None
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return body if isinstance(body, dict) else None


def _sanitizeFilename(filename):
    """Strip any directory component (defeats '../' traversal) and collapse
    everything but [A-Za-z0-9._-] to a single underscore (defeats spaces and
    other shell/URL-unfriendly characters)."""
    base = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    base = _FILENAME_DISALLOWED_RE.sub("_", base)
    base = base.strip("._")
    return base[:200] or "file"


def _errorsFromActionResult(result):
    """The shared social/handler.py action functions return either
    {"errors": [...]} (publisher validation) or {"error": "..."} (a single
    precondition failure) on ok=False. Normalize to a list for the HTTP
    contract's {"errors": [...]} shape."""
    if result.get("errors"):
        return list(result["errors"])
    return [result.get("error") or "request failed"]


# --- GET /social/accounts ---------------------------------------------------------


def getAccounts(event):
    try:
        accounts = secrets.listAccounts()
    except Exception as e:
        logger.exception("getAccounts failed: %s", e)
        return jsonResponse({"error": "could not list accounts"}, 500)
    return jsonResponse({"accounts": accounts})


# --- GET /social/posts?month=YYYY-MM ------------------------------------------------


def listPosts(event):
    qs = event.get("queryStringParameters") or {}
    month = (qs.get("month") or "").strip()
    if not _MONTH_RE.match(month):
        return jsonResponse({"error": "month must be YYYY-MM"}, 400)

    parents = storage.listPostsByMonth(month)
    posts = []
    for parent in parents:
        full = storage.getPost(parent["postId"])
        posts.append({**full["parent"], "targets": full["targets"]})
    return jsonResponse({"posts": posts})


# --- POST /social/posts -------------------------------------------------------------


def createPost(event, claims):
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"errors": ["invalid JSON body"]}, 400)

    actionEvent = {
        "text": body.get("text") or "",
        "scheduledAt": body.get("scheduledAt"),
        "accounts": body.get("accounts") or [],
        "mediaKeys": body.get("mediaKeys") or [],
        "links": body.get("links") or [],
        "createdBy": claims.get("sub", ""),
    }
    result = directHandler._actionCreate(actionEvent)
    if not result.get("ok"):
        return jsonResponse({"errors": _errorsFromActionResult(result)}, 400)

    postId = result["postId"]
    # _actionCreate's own return shape differs between the immediate-publish
    # branch (no "post" key) and the scheduled branch ("post" key) -- always
    # re-fetch so the HTTP contract's {"postId","post"} shape is uniform.
    post = storage.getPost(postId)
    return jsonResponse({"postId": postId, "post": post}, 201)


# --- GET /social/posts/{postId} -----------------------------------------------------


def getPostById(event, postId):
    post = storage.getPost(postId)
    if post["parent"] is None:
        return jsonResponse({"error": "not found"}, 404)
    return jsonResponse({"post": post})


# --- DELETE /social/posts/{postId} --------------------------------------------------


def cancelPost(event, postId):
    result = directHandler._actionCancel({"postId": postId})
    if not result.get("ok"):
        return jsonResponse({"error": result.get("error") or "not found"}, 404)
    return jsonResponse({"postId": result["postId"], "post": result["post"]})


# --- POST /social/posts/{postId}/retry ----------------------------------------------


def retryPost(event, postId):
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"errors": ["invalid JSON body"]}, 400)

    platform = body.get("platform")
    accountId = body.get("accountId")
    if bool(platform) != bool(accountId):
        return jsonResponse({"errors": ["platform and accountId must both be provided, or both omitted"]}, 400)

    if platform and accountId:
        result = directHandler._actionRetry({"postId": postId, "platform": platform, "accountId": accountId})
        if not result.get("ok"):
            status = 404 if result.get("error") == "not found" else 400
            return jsonResponse({"error": result.get("error") or "could not retry"}, status)
        post = storage.getPost(postId)
        return jsonResponse({"postId": postId, "post": post})

    # Omitted -> retry every currently-failed target.
    post = storage.getPost(postId)
    if post["parent"] is None:
        return jsonResponse({"error": "not found"}, 404)

    failedTargets = [t for t in post["targets"] if t["status"] == storage.STATUS_FAILED]
    for t in failedTargets:
        storage.updateTargetStatus(postId, t["platform"], t["accountId"], storage.STATUS_PENDING, lastError="")
    if failedTargets:
        processPost(postId)

    post = storage.getPost(postId)
    return jsonResponse({"postId": postId, "post": post})


# --- POST /social/media/presign -----------------------------------------------------


def presignMedia(event, claims):
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"errors": ["invalid JSON body"]}, 400)

    filename = str(body.get("filename") or "").strip()
    contentType = str(body.get("contentType") or "").strip()
    sizeBytes = body.get("sizeBytes")

    errors = []
    if not filename:
        errors.append("filename is required")
    if contentType not in _ALLOWED_MEDIA_CONTENT_TYPES:
        errors.append(
            f"contentType must be one of: {', '.join(sorted(_ALLOWED_MEDIA_CONTENT_TYPES))}"
        )
    if not isinstance(sizeBytes, (int, float)) or isinstance(sizeBytes, bool) or sizeBytes <= 0:
        errors.append("sizeBytes is required and must be a positive number")
    elif sizeBytes > MAX_UPLOAD_BYTES:
        errors.append(f"sizeBytes exceeds the {MAX_UPLOAD_BYTES}-byte limit")
    if errors:
        return jsonResponse({"errors": errors}, 400)

    userSub = claims.get("sub", "")
    key = f"uploads/{userSub}/{uuid.uuid4().hex}/{_sanitizeFilename(filename)}"
    uploadUrl = media.presignPut(key, contentType, expiresIn=PRESIGN_EXPIRES_IN)
    return jsonResponse({"uploadUrl": uploadUrl, "key": key, "expiresIn": PRESIGN_EXPIRES_IN})


# --- dispatch ------------------------------------------------------------------------


def route(event):
    path = event.get("rawPath", "")
    if not path:
        path = event.get("requestContext", {}).get("http", {}).get("path", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    claims, err = _requireAdmin(event)
    if err:
        return err

    if method == "GET" and path == "/social/accounts":
        return getAccounts(event)
    if method == "GET" and path == "/social/posts":
        return listPosts(event)
    if method == "POST" and path == "/social/posts":
        return createPost(event, claims)
    if method == "POST" and path == "/social/media/presign":
        return presignMedia(event, claims)

    pathParams = event.get("pathParameters") or {}
    parts = [p for p in path.split("/") if p]

    # /social/posts/{postId}
    if len(parts) == 3 and parts[0] == "social" and parts[1] == "posts":
        postId = pathParams.get("postId") or parts[2]
        if method == "GET":
            return getPostById(event, postId)
        if method == "DELETE":
            return cancelPost(event, postId)

    # /social/posts/{postId}/retry
    if len(parts) == 4 and parts[0] == "social" and parts[1] == "posts" and parts[3] == "retry":
        postId = pathParams.get("postId") or parts[2]
        if method == "POST":
            return retryPost(event, postId)

    return jsonResponse({"error": "not found"}, 404)
