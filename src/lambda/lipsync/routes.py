"""
API Gateway HTTP API (payload 2.0) dispatch for the lipsync module. Mirrors
social/routes.py's structure closely, but lipsync has no legacy direct-invoke
callers to preserve, so (unlike social, which splits handler.py from
routes.py to serve both shapes) this module's own `handler` at the bottom
IS the Lambda entrypoint Terraform points at (see infra/lipsync.tf's
aws_lambda_function.lipsyncApi, handler = "lipsync.routes.handler").

Every route requires the admin Cognito group. Group membership is read ONLY
from the JWT claims delivered by aws_apigatewayv2_authorizer.cognito (see
infra/lipsync.tf) -- never from a lookup against the main app's DynamoDB
table, since this Lambda's IAM role has no access to it by design (same
isolation model as social/routes.py; see infra/lipsync.tf's isolation
comment).

NOTE: every literal method/path dispatch below (`method == ...` and
`path == ...` on the same line) must also exist as an aws_apigatewayv2_route
in infra/lipsync.tf. tests/test_route_coverage.py guards this (see HANDLERS
in that file) for literal routes; the {jobId}-parameterised routes below are
dispatched via path-splitting (same convention as social/routes.py's
{postId} routes) and are NOT statically extractable, so they're exempt from
that check the same way social's parameterised routes are.
"""
import json
import logging
import os
import sys
import uuid
from pathlib import Path

from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from common.response import jsonResponse
except ImportError:
    # Fallback if import fails (mirrors social/routes.py and api/handler.py).
    def jsonResponse(body, statusCode=200):
        return {
            "statusCode": statusCode,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(body) if not isinstance(body, str) else body,
        }

from lipsync import media, storage
from lipsync.providers import UnknownProviderError, ValidationError, getProvider

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

DEFAULT_PROVIDER = "fal"

# design doc's Validation rules: "Audio duration <= 20s (hard cap; 15s is
# the target, 20s is the ceiling)".
MAX_AUDIO_DURATION_SEC = 20

RUNNER_FUNCTION_NAME = os.environ.get("LIPSYNC_RUNNER_FUNCTION_NAME", "")

_lambdaClient = None


def _lambdaClientFn():
    global _lambdaClient
    if _lambdaClient is None:
        import boto3
        _lambdaClient = boto3.client("lambda")
    return _lambdaClient


# --- auth ----------------------------------------------------------------------


def _getClaims(event):
    return event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims") or {}


def _parseGroups(rawGroups):
    """cognito:groups arrives as either a list, or a string. The string form
    varies by source: a JSON array `["admin","manager"]`, or Cognito's own
    stringification of a Python-style list `[admin manager]` (SPACE, not
    comma, separated). Copied verbatim from social/routes.py -- see that
    module's identical docstring for why this can't just be reused via
    import (package isolation: this Lambda's deploy zip excludes social/,
    see infra/lipsync.tf's data.archive_file.lipsync)."""
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
    authorizer, but defend anyway); 403 when the caller isn't in `admin`.
    NOTE the naming trap documented in docs/lipsync-design.md: the Cognito
    *group* is `admin`; the frontend's UserRole maps that group to the role
    `superadmin` (AuthContext.mapGroupsToRole) purely for its own nav/route
    gating (LipsyncGate). This function only ever checks the Cognito group,
    exactly like social/routes.py's _requireAdmin."""
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
    invalid JSON (callers must check for None and 400 on it). Copied
    verbatim from social/routes.py."""
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


def _invokeRunnerAsync(jobId):
    """Kick off the runner Lambda for `jobId` without waiting on it (design
    doc: "invokes the runner Lambda asynchronously ... and returns {jobId}
    immediately. The API request never waits on fal."). A failed/denied
    invoke here is tolerated, not fatal -- the job record is already
    written as `queued`, and the daily reconciliation sweep
    (maintenance.py) picks up any job whose runner invoke never landed."""
    if not RUNNER_FUNCTION_NAME:
        logger.warning("LIPSYNC_RUNNER_FUNCTION_NAME not set; runner not invoked for jobId=%s", jobId)
        return
    try:
        _lambdaClientFn().invoke(
            FunctionName=RUNNER_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps({"jobId": jobId}),
        )
    except Exception:  # noqa: BLE001 -- must never fail job creation because of this
        logger.exception("Failed to invoke lipsync runner for jobId=%s", jobId)


def _sizeCapErrorsForKey(kind, key, label):
    """head_object-based size check for image/video keys (audioKey is
    checked separately in createJob, where its bytes are already being
    downloaded for duration probing -- see that function). Returns a list
    of error strings (empty = ok). A missing object is reported the same
    way as oversized -- both are 400s the client can act on (re-upload, or
    wait for the upload to finish) rather than a 500."""
    meta = media.headObject(key)
    if meta is None:
        return [f"{label} was not found -- has the upload finished?"]
    cap = media.MAX_UPLOAD_BYTES[kind]
    if meta["contentLength"] > cap:
        return [f"{label} exceeds the {cap}-byte limit for {kind} uploads."]
    return []


# --- POST /lipsync/media/presign -----------------------------------------------------


def presignMedia(event, claims):
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"errors": ["invalid JSON body"]}, 400)

    kind = str(body.get("kind") or "").strip()
    contentType = str(body.get("contentType") or "").strip()
    filename = str(body.get("filename") or "").strip()

    errors = []
    if not filename:
        errors.append("filename is required")
    ext = None
    if kind not in media.ALLOWED_CONTENT_TYPES:
        errors.append(f"kind must be one of: {', '.join(sorted(media.ALLOWED_CONTENT_TYPES))}")
    else:
        ext = media.extensionFor(kind, contentType)
        if ext is None:
            allowed = ", ".join(sorted(media.ALLOWED_CONTENT_TYPES[kind]))
            errors.append(f"contentType for kind={kind!r} must be one of: {allowed}")
    if errors:
        return jsonResponse({"errors": errors}, 400)

    userSub = claims.get("sub", "")
    # Extension comes from the allow-listed contentType, NEVER from
    # `filename` (design doc's Validation rules) -- filename is accepted
    # per the frozen request contract but only ever used for the presence
    # check above.
    key = media.buildUploadKey(userSub, kind, ext)
    uploadUrl = media.presignPut(key, contentType)
    return jsonResponse({"uploadUrl": uploadUrl, "key": key})


# --- POST /lipsync/jobs -------------------------------------------------------------


def createJob(event, claims):
    body = _jsonBody(event)
    if body is None:
        return jsonResponse({"errors": ["invalid JSON body"]}, 400)

    mode = str(body.get("mode") or "").strip()
    audioKey = str(body.get("audioKey") or "").strip()
    imageKey = str(body.get("imageKey") or "").strip()
    videoKey = str(body.get("videoKey") or "").strip()
    modelOverride = body.get("model") or None
    prompt = str(body.get("prompt") or "").strip()
    consentAttested = body.get("consentAttested")

    errors = []
    if mode not in storage.MODES:
        errors.append(f"mode must be one of: {', '.join(sorted(storage.MODES))}")
    if not audioKey:
        errors.append("audioKey is required")
    if mode == storage.MODE_AVATAR:
        if not imageKey:
            errors.append("imageKey is required for mode=avatar")
        if videoKey:
            errors.append("videoKey must not be supplied for mode=avatar")
    elif mode == storage.MODE_RELIP:
        if not videoKey:
            errors.append("videoKey is required for mode=relip")
        if imageKey:
            errors.append("imageKey must not be supplied for mode=relip")
    if consentAttested is not True:
        errors.append("consentAttested must be true")
    if errors:
        return jsonResponse({"errors": errors}, 400)

    try:
        provider = getProvider(DEFAULT_PROVIDER)
        model = provider.modelFor(mode, modelOverride)
    except (UnknownProviderError, ValidationError) as e:
        return jsonResponse({"errors": [str(e)]}, 400)

    # Mirrors the frontend's "keep submit disabled until a required prompt is
    # filled" UX rule server-side (client validation there is UX only, never
    # trusted) -- checked via the provider so this stays provider-agnostic,
    # same as the modelFor() call just above never importing lipsync.providers.fal
    # directly.
    if provider.promptRequired(model) and not prompt:
        return jsonResponse({"errors": [f"model {model!r} requires a prompt"]}, 400)

    # Upload-size caps (design doc: "Upload size caps at presign time" --
    # the frozen PresignRequest contract carries no size field, so this is
    # enforced here instead, at job-creation time, against the objects the
    # client already PUT to S3. See media.py's module docstring and this
    # implementation's report for the full rationale.
    if mode == storage.MODE_AVATAR:
        errors.extend(_sizeCapErrorsForKey("image", imageKey, "imageKey"))
    else:
        errors.extend(_sizeCapErrorsForKey("video", videoKey, "videoKey"))
    if errors:
        return jsonResponse({"errors": errors}, 400)

    try:
        audioBytes = media.getBytes(audioKey)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return jsonResponse({"errors": ["audioKey was not found -- has the upload finished?"]}, 400)
        logger.exception("createJob: could not read audioKey=%s", audioKey)
        return jsonResponse({"error": "could not process the uploaded audio"}, 500)
    except Exception:  # noqa: BLE001 -- typed, user-safe response; never leak the raw exception
        logger.exception("createJob: could not read audioKey=%s", audioKey)
        return jsonResponse({"error": "could not process the uploaded audio"}, 500)

    if len(audioBytes) > media.MAX_UPLOAD_BYTES["audio"]:
        return jsonResponse(
            {"errors": [f"audioKey exceeds the {media.MAX_UPLOAD_BYTES['audio']}-byte limit for audio uploads."]}, 400
        )

    # Fail CLOSED on an unreadable duration. The 20MB size cap is not a usable
    # backstop -- 20MB of 128kbps mp3 is ~21 minutes, which at Kling's
    # $0.115/s would bill ~$143 for a single clip. Every allow-listed audio
    # type is covered by probeDurationSeconds, so a parse failure signals a
    # malformed file rather than a legitimate one; rejecting costs the caller
    # a re-encode, allowing it costs real money.
    durationSec = media.probeDurationSeconds(audioBytes, media.extensionOfKey(audioKey))
    if durationSec is None:
        return jsonResponse(
            {"errors": ["Could not read the audio duration. Re-encode as WAV or M4A and try again."]}, 400
        )
    if durationSec > MAX_AUDIO_DURATION_SEC:
        return jsonResponse(
            {"errors": [f"Audio is {durationSec:.1f}s, over the {MAX_AUDIO_DURATION_SEC}s limit."]}, 400
        )

    jobId = uuid.uuid4().hex
    job = storage.createJob(
        jobId=jobId,
        mode=mode,
        provider=DEFAULT_PROVIDER,
        model=model,
        audioKey=audioKey,
        imageKey=imageKey,
        videoKey=videoKey,
        prompt=prompt,
        createdBy=claims.get("sub", ""),
        consentAttested=True,
    )

    _invokeRunnerAsync(jobId)

    return jsonResponse({"jobId": jobId, "status": job["status"]}, 201)


# --- GET /lipsync/jobs?status=&limit=&cursor= ---------------------------------------


def listJobs(event):
    qs = event.get("queryStringParameters") or {}

    status = (qs.get("status") or "").strip() or None
    if status and status not in storage.ALL_STATUSES:
        return jsonResponse({"error": f"status must be one of: {', '.join(sorted(storage.ALL_STATUSES))}"}, 400)

    limit = storage.DEFAULT_LIST_LIMIT
    limitRaw = qs.get("limit")
    if limitRaw:
        try:
            limit = max(1, min(int(limitRaw), storage.MAX_LIST_LIMIT))
        except ValueError:
            return jsonResponse({"error": "limit must be an integer"}, 400)

    cursor = qs.get("cursor") or None

    jobs, nextCursor = storage.listJobs(status=status, limit=limit, cursor=cursor)
    return jsonResponse({"jobs": jobs, "cursor": nextCursor})


# --- GET /lipsync/jobs/{jobId} -------------------------------------------------------


def getJobById(event, jobId):
    job = storage.getJob(jobId)
    if job is None:
        return jsonResponse({"error": "not found"}, 404)
    return jsonResponse({"job": job})


# --- DELETE /lipsync/jobs/{jobId} ----------------------------------------------------


def cancelJobRoute(event, jobId):
    result = storage.cancelJob(jobId)
    if result is None:
        return jsonResponse({"error": "not found"}, 404)
    if result is False:
        return jsonResponse({"error": "job is already finished and cannot be cancelled"}, 409)
    return jsonResponse({"jobId": jobId, "status": result["status"]})


# --- GET /lipsync/jobs/{jobId}/output ------------------------------------------------


def getJobOutput(event, jobId):
    job = storage.getJob(jobId)
    if job is None:
        return jsonResponse({"error": "not found"}, 404)
    if job.get("status") != storage.STATUS_COMPLETED or not job.get("outputKey"):
        return jsonResponse({"error": "output is not available for this job"}, 400)
    url = media.presignGet(job["outputKey"], expiresIn=media.OUTPUT_URL_EXPIRES_IN)
    return jsonResponse({"url": url})


# --- dispatch ------------------------------------------------------------------------


def route(event):
    path = event.get("rawPath", "")
    if not path:
        path = event.get("requestContext", {}).get("http", {}).get("path", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    claims, err = _requireAdmin(event)
    if err:
        return err

    if method == "POST" and path == "/lipsync/media/presign":
        return presignMedia(event, claims)
    if method == "POST" and path == "/lipsync/jobs":
        return createJob(event, claims)
    if method == "GET" and path == "/lipsync/jobs":
        return listJobs(event)

    pathParams = event.get("pathParameters") or {}
    parts = [p for p in path.split("/") if p]

    # /lipsync/jobs/{jobId}
    if len(parts) == 3 and parts[0] == "lipsync" and parts[1] == "jobs":
        jobId = pathParams.get("jobId") or parts[2]
        if method == "GET":
            return getJobById(event, jobId)
        if method == "DELETE":
            return cancelJobRoute(event, jobId)

    # /lipsync/jobs/{jobId}/output
    if len(parts) == 4 and parts[0] == "lipsync" and parts[1] == "jobs" and parts[3] == "output":
        jobId = pathParams.get("jobId") or parts[2]
        if method == "GET":
            return getJobOutput(event, jobId)

    return jsonResponse({"error": "not found"}, 404)


def handler(event, context):
    return route(event)
