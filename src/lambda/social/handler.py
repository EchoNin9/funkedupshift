"""
Lambda handler for social publishing/scheduling.

Serves TWO invocation shapes from the same entrypoint:
  - API Gateway HTTP API v2 events (phase 4, socialApi Lambda routed through
    aws_apigatewayv2_api.main -- see infra/social.tf) -- detected via
    event["requestContext"]["http"], delegated to social/routes.py, which
    returns a full statusCode/body/headers envelope.
  - Direct invokes (phases 1-2, still used by scripts/social_schedule.py and
    scripts/social_invoke_bluesky.py) -- returns a plain dict, NEVER an API
    Gateway envelope. This path is unchanged by phase 4.

Default direct-invoke behaviour (no "action" key in the event) is the
phase-1 immediate-publish path, preserved verbatim. Phase 2 added an
"action" field for create/get/listMonth/cancel/retry against the
DynamoDB-backed scheduler -- those functions (_actionCreate etc.) are also
the shared core social/routes.py calls for the HTTP path, so business logic
lives in exactly one place.
"""
import base64
import logging
import uuid

from social import publisher, scheduling, storage
from social.publishers import PublishRequest, UnknownPublisherError, getPublisher

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _decodeMedia(media):
    """Event media items carry base64-encoded image bytes (JSON can't carry
    raw bytes); decode each item's "bytes" field before it reaches the
    publisher, which expects real bytes."""
    decoded = []
    for item in media or []:
        item = dict(item)
        raw = item.get("bytes")
        item["bytes"] = base64.b64decode(raw) if raw else b""
        decoded.append(item)
    return decoded


def _immediatePublish(event):
    """Phase-1 behaviour, unchanged: single-platform, synchronous publish."""
    accountId = event.get("accountId")
    platform = event.get("platform") or "bluesky"
    text = event.get("text") or ""
    media = _decodeMedia(event.get("media"))
    links = event.get("links") or []

    try:
        PublisherClass = getPublisher(platform)
    except UnknownPublisherError as e:
        return {"ok": False, "error": str(e)}

    pub = PublisherClass()
    request = PublishRequest(accountId=accountId, text=text, media=media, links=links)

    # Validate first -- never attempt to publish (i.e. never make an HTTP
    # call) if the request is invalid.
    errors = pub.validate(request)
    if errors:
        return {"ok": False, "errors": errors}

    result = pub.publish(request)
    return {
        "ok": result.ok,
        "permalink": result.permalink,
        "platformPostId": result.platformPostId,
        "error": result.error,
    }


# --- phase-2 scheduling actions ------------------------------------------------


def _actionCreate(event):
    """Validate every target via its publisher's validate() BEFORE writing
    anything, then write DDB, then create the EventBridge schedule (or
    publish immediately if scheduledAt is at/near now)."""
    text = event.get("text") or ""
    links = event.get("links") or []
    mediaKeys = event.get("mediaKeys") or []
    scheduledAt = event.get("scheduledAt")
    createdBy = event.get("createdBy") or ""
    accounts = event.get("accounts") or []  # [{"platform":, "accountId":, "overrides": {}}]

    if not scheduledAt:
        return {"ok": False, "error": "scheduledAt is required"}
    if not accounts:
        return {"ok": False, "error": "at least one account target is required"}

    allErrors = []
    for acc in accounts:
        try:
            PublisherClass = getPublisher(acc["platform"])
        except UnknownPublisherError as e:
            allErrors.append(str(e))
            continue
        overrideText = (acc.get("overrides") or {}).get("text", text)
        # Media BYTES aren't fetched at validation time (they're referenced by
        # S3 key and pulled lazily at publish time), but the media LIST must
        # still reflect what was attached: Instagram requires at least one
        # item, so passing media=[] here made every Instagram post
        # unschedulable regardless of what the caller attached.
        #
        # Descriptors carry the key and a mime type guessed from the
        # extension -- enough for count and type rules (e.g. Instagram's
        # JPEG-only images) to run at schedule time. Size and aspect-ratio
        # checks need real bytes and are skipped here; both validators read
        # "bytes" defensively and treat a missing value as size 0.
        mediaForValidation = [
            {"key": key, "mimeType": publisher._guessMimeType(key), "alt": ""}
            for key in mediaKeys
        ]
        request = PublishRequest(
            accountId=acc["accountId"], text=overrideText, media=mediaForValidation, links=links
        )
        allErrors.extend(PublisherClass().validate(request))
    if allErrors:
        return {"ok": False, "errors": allErrors}

    postId = event.get("postId") or uuid.uuid4().hex

    try:
        outcome = scheduling.createOneShot(postId, scheduledAt)
    except Exception as e:
        logger.exception("createOneShot failed for postId=%s", postId)
        return {"ok": False, "error": f"Could not create schedule: {e}"}

    try:
        post = storage.createPost(
            postId=postId,
            text=text,
            mediaKeys=mediaKeys,
            links=links,
            scheduledAt=scheduledAt,
            createdBy=createdBy,
            targets=accounts,
            scheduleName=outcome.get("scheduleName") or "",
        )
    except storage.PostAlreadyExistsError as e:
        return {"ok": False, "error": str(e)}

    if outcome.get("immediate"):
        publishResult = publisher.processPost(postId)
        return {"ok": True, "postId": postId, "immediate": True, "publishResult": publishResult}

    return {
        "ok": True,
        "postId": postId,
        "immediate": False,
        "scheduleName": outcome.get("scheduleName"),
        "post": post,
    }


def _actionGet(event):
    postId = event.get("postId")
    if not postId:
        return {"ok": False, "error": "postId is required"}
    post = storage.getPost(postId)
    if post["parent"] is None:
        return {"ok": False, "error": "not found"}
    return {"ok": True, "post": post}


def _actionListMonth(event):
    monthKey = event.get("month")
    if not monthKey:
        return {"ok": False, "error": "month is required"}
    return {"ok": True, "items": storage.listPostsByMonth(monthKey)}


def _actionCancel(event):
    postId = event.get("postId")
    if not postId:
        return {"ok": False, "error": "postId is required"}
    post = storage.getPost(postId)
    if post["parent"] is None:
        return {"ok": False, "error": "not found"}

    scheduleName = post["parent"].get("scheduleName")
    if scheduleName:
        try:
            scheduling.cancelOneShot(scheduleName)
        except Exception as e:
            logger.exception("cancelOneShot failed for postId=%s", postId)
            return {"ok": False, "error": f"Could not cancel schedule: {e}"}

    updated = storage.cancelPost(postId)
    return {"ok": True, "postId": postId, "post": updated}


def _actionRetry(event):
    """Reset one failed target back to pending and republish the whole post
    now (processPost skips every other target -- it's already terminal or
    still legitimately pending -- so this only touches the target being
    retried)."""
    postId = event.get("postId")
    platform = event.get("platform")
    accountId = event.get("accountId")
    if not (postId and platform and accountId):
        return {"ok": False, "error": "postId, platform, and accountId are required"}

    post = storage.getPost(postId)
    if post["parent"] is None:
        return {"ok": False, "error": "not found"}

    target = next(
        (t for t in post["targets"] if t["platform"] == platform and t["accountId"] == accountId), None
    )
    if target is None:
        return {"ok": False, "error": "target not found"}
    if target["status"] != storage.STATUS_FAILED:
        return {"ok": False, "error": f"target is not in a failed state (status={target['status']})"}

    storage.updateTargetStatus(postId, platform, accountId, storage.STATUS_PENDING, lastError="")

    result = publisher.processPost(postId)
    return {"ok": True, "postId": postId, "publishResult": result}


_ACTIONS = {
    "create": _actionCreate,
    "get": _actionGet,
    "listMonth": _actionListMonth,
    "cancel": _actionCancel,
    "retry": _actionRetry,
}


def handler(event, context):
    event = event or {}

    # API Gateway HTTP API v2 events always carry requestContext.http;
    # direct invokes (scripts, EventBridge-adjacent callers) never do.
    if event.get("requestContext", {}).get("http"):
        from social import routes
        return routes.route(event)

    action = event.get("action")
    if not action:
        return _immediatePublish(event)

    fn = _ACTIONS.get(action)
    if fn is None:
        return {"ok": False, "error": f"unknown action: {action}"}
    return fn(event)
