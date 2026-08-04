"""
EventBridge Scheduler target -- publishes one social post's fan-out targets.

Idempotent by design: any target already 'published' (or otherwise terminal)
is skipped, and every target transitions to 'publishing' via a conditional
write (status != published) before the platform API call, so a
reconciliation-sweep re-invocation racing a still-live schedule can never
double-post.

Phase 5 adds async-publish support: a publisher may accept media but not
finish publishing synchronously (PublishResult(pending=True)) -- e.g. Meta's
container-processing flow for Reels/video. That target moves to the
'processing' status (non-terminal) and a container-check schedule resumes it
via checkContainer() below, instead of the normal one-shot postId schedule.
"""
import logging
from datetime import datetime, timedelta, timezone

from social import alerts, media, scheduling, storage
from social.publishers import PublishRequest, PublishResult, UnknownPublisherError, getPublisher

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_ATTEMPTS = 3
RETRY_DELAY_MINUTES = 5

# Meta advises polling once a minute for ~5 minutes, but real Reels
# processing can exceed that; the publisher itself supplies the interval via
# PublishResult.checkAfterSec -- this is the absolute ceiling on how many
# times we'll resume a single pending publish (~80 min with the intended
# backoff) before treating it as a failed attempt instead.
MAX_CONTAINER_CHECKS = 20

# Presigned GET URL lifetime for the needsMediaBytes=False path (the
# publisher receives a URL instead of raw bytes so a large video never has
# to be loaded into the 128MB publisher Lambda). Meta fetches the media
# server-side; a large video download must not outlive the URL, so this is
# deliberately longer than media.presignGet's 1-hour default.
CONTAINER_MEDIA_URL_EXPIRES_SEC = 21600

_MIME_BY_EXT = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    # Video MUST be mapped. Publishers branch on a "video/" mime prefix to
    # decide how to publish (Instagram sends video_url + media_type=REELS
    # rather than image_url), so a video falling through to the image default
    # below makes every Reel get published as though it were a photo.
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
}
# Only reached for extensions not listed above; the media presign route
# restricts uploads to jpeg/png/webp/mp4, so this is a conservative fallback
# rather than a real guess.
_DEFAULT_MIME = "image/jpeg"


def _guessMimeType(key):
    lower = key.lower()
    for ext, mime in _MIME_BY_EXT.items():
        if lower.endswith(ext):
            return mime
    return _DEFAULT_MIME


def _isoInSeconds(seconds):
    when = datetime.now(timezone.utc) + timedelta(seconds=max(seconds or 0, 0))
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _retryTimeIso():
    when = datetime.now(timezone.utc) + timedelta(minutes=RETRY_DELAY_MINUTES)
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _buildPublishRequest(parent, target, PublisherClass=None):
    """Merge the parent payload with a target's per-account overrides.

    overrides may carry "text", "links", and/or "media" (a list of
    {"key": <one of parent.mediaKeys>, "alt": <str>} used to attach
    per-account alt text) -- the actual media bytes/S3 keys always come from
    the parent's mediaKeys; overrides only adjust alt text and text/links
    per account, they never add media the parent doesn't already reference.

    Media item shape depends on the publisher's needsMediaBytes:
      True  -> {"key", "mimeType", "alt", "bytes"}   (unchanged; Bluesky)
      False -> {"key", "mimeType", "alt", "url"}     (media.getBytes is
                NEVER called for that target -- a presigned GET URL is
                handed to the publisher instead, so a large video is never
                loaded into memory here).

    `PublisherClass` is optional -- when omitted (e.g. a caller that only
    has parent/target on hand, like the existing idempotencyKey test) it is
    looked up from target["platform"], defaulting every existing publisher
    to needsMediaBytes=True (unchanged behaviour).
    """
    overrides = target.get("overrides") or {}
    text = overrides.get("text", parent.get("text", ""))
    links = overrides.get("links", parent.get("links") or [])

    altByKey = {}
    for m in overrides.get("media") or []:
        if isinstance(m, dict) and m.get("key"):
            altByKey[m["key"]] = m.get("alt", "")

    postId = parent["postId"]
    platform = target["platform"]
    accountId = target["accountId"]

    if PublisherClass is None:
        PublisherClass = getPublisher(platform)
    needsMediaBytes = getattr(PublisherClass, "needsMediaBytes", True)

    mediaItems = []
    for key in parent.get("mediaKeys") or []:
        item = {"key": key, "mimeType": _guessMimeType(key), "alt": altByKey.get(key, "")}
        if needsMediaBytes:
            item["bytes"] = media.getBytes(key)
        else:
            item["url"] = media.presignGet(key, expiresIn=CONTAINER_MEDIA_URL_EXPIRES_SEC)
        mediaItems.append(item)

    def _onContainerCreated(containerId):
        storage.setTargetContainer(postId, platform, accountId, containerId)

    return PublishRequest(
        accountId=accountId,
        text=text,
        media=mediaItems,
        links=links,
        overrides=overrides,
        idempotencyKey=f"{postId}:{platform}:{accountId}",
        scheduledAt=parent.get("scheduledAt", ""),
        onContainerCreated=_onContainerCreated,
    )


def _handleFailure(parent, platform, accountId, errorMessage):
    """Shared failure ladder: increment attemptCount; retry the whole post
    via rescheduleOneShot if attempts remain, else mark this target failed
    (the caller alerts). Used by _processTarget's synchronous publish
    failure AND by checkContainer's async checkPending failure (including
    the MAX_CONTAINER_CHECKS ceiling, which is treated as a failed attempt
    rather than rescheduling container checks forever)."""
    postId = parent["postId"]
    attemptCount = storage.incrementAttempt(postId, platform, accountId)
    if attemptCount >= MAX_ATTEMPTS:
        storage.updateTargetStatus(postId, platform, accountId, storage.STATUS_FAILED, lastError=errorMessage or "")
        return {
            "platform": platform, "accountId": accountId, "status": storage.STATUS_FAILED,
            "error": errorMessage, "attemptCount": attemptCount, "skipped": False,
        }

    storage.updateTargetStatus(postId, platform, accountId, storage.STATUS_PENDING, lastError=errorMessage or "")
    try:
        scheduling.rescheduleOneShot(postId, _retryTimeIso(), oldScheduleName=parent.get("scheduleName"))
    except Exception:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception(
            "Failed to reschedule retry for postId=%s platform=%s accountId=%s", postId, platform, accountId
        )
    return {
        "platform": platform, "accountId": accountId, "status": storage.STATUS_PENDING,
        "error": errorMessage, "attemptCount": attemptCount, "skipped": False, "rescheduled": True,
    }


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
        request = _buildPublishRequest(parent, target, PublisherClass)
        result = PublisherClass().publish(request)
    except UnknownPublisherError as e:
        result = PublishResult(ok=False, error=str(e))
    except Exception as e:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception(
            "Unexpected error publishing postId=%s platform=%s accountId=%s", postId, platform, accountId
        )
        result = PublishResult(ok=False, error=str(e))

    # ORDER MATTERS: pending is checked BEFORE ok. A publisher signals "the
    # platform accepted this but publishing isn't finished" as pending=True
    # while ok is also True (it is not an error). Testing ok first would mark
    # a still-processing Reel as published the moment its container was
    # created -- success in the UI, nothing ever on Instagram.
    if result.pending:
        # Platform accepted the media but publishing isn't complete --
        # NOT a failure: don't touch attemptCount, don't mark the parent
        # published/failed. markTargetProcessing deliberately never sets
        # statusKey (the sparse byStatusTime GSI is STATUS#pending only),
        # so a processing target is invisible to the overdue-pending sweep
        # and can't be republished mid-processing.
        storage.markTargetProcessing(postId, platform, accountId, result.containerId, checkCount=1)
        try:
            scheduling.createContainerCheck(
                postId, platform, accountId, _isoInSeconds(result.checkAfterSec), checkCount=1
            )
        except Exception:  # noqa: BLE001 -- must never raise out of the handler
            logger.exception(
                "Failed to schedule container check for postId=%s platform=%s accountId=%s",
                postId, platform, accountId,
            )
        return {
            "platform": platform, "accountId": accountId, "status": storage.STATUS_PROCESSING,
            "containerId": result.containerId, "skipped": False,
        }

    if result.ok:
        storage.updateTargetStatus(
            postId, platform, accountId, storage.STATUS_PUBLISHED,
            permalink=result.permalink or "", platformPostId=result.platformPostId or "", lastError="",
        )
        return {"platform": platform, "accountId": accountId, "status": storage.STATUS_PUBLISHED, "skipped": False}

    return _handleFailure(parent, platform, accountId, result.error)


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


def checkContainer(postId, platform, accountId, checkCount):
    """Resume a pending (async-container) publish. Fired by the container-
    check schedule createContainerCheck() created. Idempotent: a duplicate
    schedule firing, or one for a target that already reached a terminal
    status by other means, is a no-op -- never raises."""
    try:
        post = storage.getPost(postId)
        parent = post["parent"]
        if parent is None:
            logger.warning("checkContainer: postId=%s not found", postId)
            return {"ok": False, "postId": postId, "error": "post not found"}

        target = next(
            (t for t in post["targets"] if t["platform"] == platform and t["accountId"] == accountId), None
        )
        if target is None:
            logger.warning(
                "checkContainer: target not found postId=%s platform=%s accountId=%s", postId, platform, accountId
            )
            return {
                "ok": False, "postId": postId, "platform": platform, "accountId": accountId,
                "error": "target not found",
            }

        if target["status"] in storage.TARGET_TERMINAL_STATUSES:
            # Already resolved (e.g. a duplicate schedule firing after the
            # first check already published it) -- harmless no-op.
            return {
                "ok": True, "postId": postId, "platform": platform, "accountId": accountId,
                "status": target["status"], "skipped": True,
            }

        containerId = target.get("containerId", "")

        try:
            PublisherClass = getPublisher(platform)
            request = _buildPublishRequest(parent, target, PublisherClass)
            result = PublisherClass().checkPending(request, containerId, checkCount)
        except UnknownPublisherError as e:
            result = PublishResult(ok=False, error=str(e))
        except Exception as e:  # noqa: BLE001 -- must never raise out of the handler
            logger.exception(
                "Unexpected error checking container postId=%s platform=%s accountId=%s", postId, platform, accountId
            )
            result = PublishResult(ok=False, error=str(e))

        # ORDER MATTERS -- same reasoning as _processTarget above. A poll that
        # comes back IN_PROGRESS is pending=True AND ok=True; testing ok first
        # would mark the post published and stop polling on the very first
        # check, so the Reel would never actually be published.
        if result.pending:
            if checkCount >= MAX_CONTAINER_CHECKS:
                # Ceiling reached -- stop the container-check loop and fold
                # this into the ordinary attempt-count failure ladder
                # instead of polling forever.
                outcome = _handleFailure(parent, platform, accountId, result.error or "Exceeded max container checks")
                if outcome["status"] == storage.STATUS_FAILED:
                    alerts.sendAlert(
                        f"Social post {postId}: {platform}/{accountId} failed permanently",
                        outcome.get("error") or "Exceeded max container checks",
                    )
                derivedStatus = storage.rollupParentStatus(postId)
                return {"ok": True, "postId": postId, "parentStatus": derivedStatus, **outcome}

            nextCheckCount = checkCount + 1
            storage.markTargetProcessing(
                postId, platform, accountId, result.containerId or containerId, checkCount=nextCheckCount
            )
            try:
                scheduling.createContainerCheck(
                    postId, platform, accountId, _isoInSeconds(result.checkAfterSec), checkCount=nextCheckCount
                )
            except Exception:  # noqa: BLE001 -- must never raise out of the handler
                logger.exception(
                    "Failed to reschedule container check for postId=%s platform=%s accountId=%s",
                    postId, platform, accountId,
                )
            return {
                "ok": True, "postId": postId, "platform": platform, "accountId": accountId,
                "status": storage.STATUS_PROCESSING, "checkCount": nextCheckCount, "rescheduled": True,
            }

        if result.ok:
            storage.updateTargetStatus(
                postId, platform, accountId, storage.STATUS_PUBLISHED,
                permalink=result.permalink or "", platformPostId=result.platformPostId or "", lastError="",
            )
            derivedStatus = storage.rollupParentStatus(postId)
            return {
                "ok": True, "postId": postId, "platform": platform, "accountId": accountId,
                "status": storage.STATUS_PUBLISHED, "parentStatus": derivedStatus,
            }

        # ok=False, not pending -- the existing failure machinery.
        outcome = _handleFailure(parent, platform, accountId, result.error)
        if outcome["status"] == storage.STATUS_FAILED:
            alerts.sendAlert(
                f"Social post {postId}: {platform}/{accountId} failed permanently", outcome.get("error") or "",
            )
        derivedStatus = storage.rollupParentStatus(postId)
        return {"ok": True, "postId": postId, "parentStatus": derivedStatus, **outcome}
    except Exception as e:  # noqa: BLE001 -- last-resort guard, must not raise
        logger.exception("Unhandled error in checkContainer postId=%s", postId)
        alerts.sendAlert(f"Social post {postId}: unhandled checkContainer error", str(e))
        return {"ok": False, "postId": postId, "platform": platform, "accountId": accountId, "error": str(e)}


def handler(event, context):
    """EventBridge Scheduler target.

    event = {"postId": "..."} for the normal publish path (unchanged), or
    {"job": "checkContainer", "postId", "platform", "accountId", "checkCount"}
    to resume a pending async publish. Must never raise for an expected
    failure mode -- logs, alerts, and returns a summary dict either way.
    """
    event = event or {}

    if event.get("job") == "checkContainer":
        postId = event.get("postId")
        platform = event.get("platform")
        accountId = event.get("accountId")
        checkCount = event.get("checkCount", 1)
        if not postId or not platform or not accountId:
            logger.error("social publisher invoked for checkContainer with missing fields: %s", event)
            return {"ok": False, "error": "postId, platform, and accountId are required", "results": []}
        return checkContainer(postId, platform, accountId, checkCount)

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
