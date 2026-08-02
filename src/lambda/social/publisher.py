"""
EventBridge Scheduler target -- publishes one social post's fan-out targets.

Idempotent by design: any target already 'published' (or otherwise terminal)
is skipped, and every target transitions to 'publishing' via a conditional
write (status != published) before the platform API call, so a
reconciliation-sweep re-invocation racing a still-live schedule can never
double-post.
"""
import logging
from datetime import datetime, timedelta, timezone

from social import alerts, media, scheduling, storage
from social.publishers import PublishRequest, PublishResult, UnknownPublisherError, getPublisher

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_ATTEMPTS = 3
RETRY_DELAY_MINUTES = 5

_MIME_BY_EXT = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}
_DEFAULT_MIME = "image/jpeg"


def _guessMimeType(key):
    lower = key.lower()
    for ext, mime in _MIME_BY_EXT.items():
        if lower.endswith(ext):
            return mime
    return _DEFAULT_MIME


def _retryTimeIso():
    when = datetime.now(timezone.utc) + timedelta(minutes=RETRY_DELAY_MINUTES)
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _buildPublishRequest(parent, target):
    """Merge the parent payload with a target's per-account overrides.

    overrides may carry "text", "links", and/or "media" (a list of
    {"key": <one of parent.mediaKeys>, "alt": <str>} used to attach
    per-account alt text) -- the actual media bytes/S3 keys always come from
    the parent's mediaKeys; overrides only adjust alt text and text/links
    per account, they never add media the parent doesn't already reference.
    """
    overrides = target.get("overrides") or {}
    text = overrides.get("text", parent.get("text", ""))
    links = overrides.get("links", parent.get("links") or [])

    altByKey = {}
    for m in overrides.get("media") or []:
        if isinstance(m, dict) and m.get("key"):
            altByKey[m["key"]] = m.get("alt", "")

    mediaItems = []
    for key in parent.get("mediaKeys") or []:
        raw = media.getBytes(key)
        mediaItems.append({"bytes": raw, "mimeType": _guessMimeType(key), "alt": altByKey.get(key, "")})

    return PublishRequest(
        accountId=target["accountId"],
        text=text,
        media=mediaItems,
        links=links,
        overrides=overrides,
    )


def _processTarget(parent, target):
    """Publish (or skip) a single target. Returns a small result dict; never
    raises -- expected failures (validation, network, platform API errors,
    an unregistered platform) are all captured and reported back."""
    postId = parent["postId"]
    platform = target["platform"]
    accountId = target["accountId"]

    if target["status"] in storage.TARGET_TERMINAL_STATUSES:
        return {"platform": platform, "accountId": accountId, "status": target["status"], "skipped": True}

    claimed = storage.updateTargetStatus(
        postId, platform, accountId, storage.STATUS_PUBLISHING, expectedNotStatus=storage.STATUS_PUBLISHED
    )
    if not claimed:
        # Lost the race -- another invocation (a live schedule vs. the
        # reconciliation sweep) already published this target.
        return {"platform": platform, "accountId": accountId, "status": storage.STATUS_PUBLISHED, "skipped": True}

    try:
        PublisherClass = getPublisher(platform)
        request = _buildPublishRequest(parent, target)
        result = PublisherClass().publish(request)
    except UnknownPublisherError as e:
        result = PublishResult(ok=False, error=str(e))
    except Exception as e:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception(
            "Unexpected error publishing postId=%s platform=%s accountId=%s", postId, platform, accountId
        )
        result = PublishResult(ok=False, error=str(e))

    if result.ok:
        storage.updateTargetStatus(
            postId, platform, accountId, storage.STATUS_PUBLISHED,
            permalink=result.permalink or "", platformPostId=result.platformPostId or "", lastError="",
        )
        return {"platform": platform, "accountId": accountId, "status": storage.STATUS_PUBLISHED, "skipped": False}

    attemptCount = storage.incrementAttempt(postId, platform, accountId)
    if attemptCount >= MAX_ATTEMPTS:
        storage.updateTargetStatus(postId, platform, accountId, storage.STATUS_FAILED, lastError=result.error or "")
        return {
            "platform": platform, "accountId": accountId, "status": storage.STATUS_FAILED,
            "error": result.error, "attemptCount": attemptCount, "skipped": False,
        }

    storage.updateTargetStatus(postId, platform, accountId, storage.STATUS_PENDING, lastError=result.error or "")
    try:
        scheduling.rescheduleOneShot(postId, _retryTimeIso(), oldScheduleName=parent.get("scheduleName"))
    except Exception:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception(
            "Failed to reschedule retry for postId=%s platform=%s accountId=%s", postId, platform, accountId
        )
    return {
        "platform": platform, "accountId": accountId, "status": storage.STATUS_PENDING,
        "error": result.error, "attemptCount": attemptCount, "skipped": False, "rescheduled": True,
    }


def processPost(postId):
    """Process every not-yet-terminal target of `postId`. Shared by the
    EventBridge Scheduler entry point (handler, below) and the maintenance
    reconciliation sweep, so both run identical, idempotent logic."""
    post = storage.getPost(postId)
    parent = post["parent"]
    if parent is None:
        logger.warning("processPost: postId=%s not found", postId)
        return {"ok": False, "postId": postId, "error": "post not found", "results": []}

    results = [_processTarget(parent, t) for t in post["targets"]]

    permanentFailures = [r for r in results if r.get("status") == storage.STATUS_FAILED and not r.get("skipped")]
    if permanentFailures:
        lines = [f"{r['platform']}/{r['accountId']}: {r.get('error')}" for r in permanentFailures]
        alerts.sendAlert(
            f"Social post {postId}: {len(permanentFailures)} target(s) failed permanently",
            "\n".join(lines),
        )

    derivedStatus = storage.rollupParentStatus(postId)
    return {"ok": True, "postId": postId, "status": derivedStatus, "results": results}


def handler(event, context):
    """EventBridge Scheduler target. event = {"postId": "..."}. Must never
    raise for an expected failure mode -- logs, alerts, and returns a summary
    dict either way."""
    event = event or {}
    postId = event.get("postId")
    if not postId:
        logger.error("social publisher invoked without postId: %s", event)
        return {"ok": False, "error": "postId is required", "results": []}

    try:
        return processPost(postId)
    except Exception as e:  # noqa: BLE001 -- last-resort guard, handler must not raise
        logger.exception("Unhandled error processing postId=%s", postId)
        alerts.sendAlert(f"Social post {postId}: unhandled publisher error", str(e))
        return {"ok": False, "postId": postId, "error": str(e), "results": []}
