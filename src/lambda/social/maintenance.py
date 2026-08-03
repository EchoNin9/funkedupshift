"""
Scheduled maintenance for the social scheduling module: a reconciliation
sweep (safety net for a lost/never-fired EventBridge one-shot schedule) plus
a daily heartbeat so operational silence itself is visible.
"""
import logging
from datetime import datetime, timedelta, timezone

from social import alerts, publisher, storage

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

DEFAULT_GRACE_MINUTES = 15

# A processing target is invisible to the overdue-pending sweep (it never
# carries statusKey), so it needs its own recovery path.
STUCK_PROCESSING_GRACE_MINUTES = 30  # updatedAt this stale -> its check schedule was likely lost
# Meta documents container validity as 24 hours after creation; past that
# the platform container can no longer be published to, no matter how many
# times we poll it.
CONTAINER_VALIDITY_HOURS = 24


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _isoSinceHours(hours):
    when = datetime.now(timezone.utc) - timedelta(hours=hours)
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _recoverStrandedContainers():
    """Two independent recovery checks for targets stuck in the non-terminal
    'processing' status (async-container publish in progress):

      - updatedAt stale (STUCK_PROCESSING_GRACE_MINUTES) -> its container-
        check schedule was probably lost; re-run checkContainer once to
        resume it.
      - containerCreatedAt past CONTAINER_VALIDITY_HOURS -> the platform
        container has expired and can never be published; mark the target
        failed and alert. Checked independently of updatedAt because
        containerCreatedAt is set once and never advances, so a target can
        look "fresh" by updatedAt while still sitting on an expired
        container.

    Order matters: stale targets are resumed first (a fresh scan for
    expired containers afterwards means one that just got resolved won't
    be double-counted as expired).
    """
    resumed = []

    staleTargets = storage.findStuckProcessingTargets(STUCK_PROCESSING_GRACE_MINUTES)
    for t in staleTargets:
        postId, targetPlatform, accountId = t["postId"], t["platform"], t["accountId"]
        checkCount = t.get("containerCheckCount", 1)
        publisher.checkContainer(postId, targetPlatform, accountId, checkCount)
        resumed.append({"postId": postId, "platform": targetPlatform, "accountId": accountId})

    expired = []
    expiredTargets = storage.findExpiredContainerTargets(CONTAINER_VALIDITY_HOURS)
    for t in expiredTargets:
        postId, targetPlatform, accountId = t["postId"], t["platform"], t["accountId"]
        storage.updateTargetStatus(
            postId, targetPlatform, accountId, storage.STATUS_FAILED,
            expectedNotStatus=storage.STATUS_PUBLISHED,
            lastError=f"Container expired (exceeded {CONTAINER_VALIDITY_HOURS}h validity window)",
        )
        storage.rollupParentStatus(postId)
        expired.append({"postId": postId, "platform": targetPlatform, "accountId": accountId})

    if expired:
        names = [f"{e['postId']}/{e['platform']}/{e['accountId']}" for e in expired]
        alerts.sendAlert(
            "Social reconcile: expired containers marked failed",
            f"{len(expired)} target(s) exceeded the {CONTAINER_VALIDITY_HOURS}h container validity "
            f"window: {', '.join(names)}",
        )

    return {"resumed": resumed, "expired": expired}


def _reconcile(graceMinutes=DEFAULT_GRACE_MINUTES):
    nowIso = _isoNowUtc()
    overdueParents = storage.findOverduePending(nowIso, graceMinutes)

    retriedPostIds = []
    cappedTargets = []

    for parent in overdueParents:
        postId = parent["postId"]
        post = storage.getPost(postId)
        targets = post["targets"]
        # A target that already burned all its attempts but is still not
        # terminal can happen if a prior publisher invocation crashed after
        # incrementAttempt/updateTargetStatus but before the parent rollup --
        # mark it failed directly rather than handing it back to
        # processPost(), which would just re-attempt it past the cap.
        overCap = [
            t for t in targets
            if t["status"] not in storage.TARGET_TERMINAL_STATUSES
            and t.get("attemptCount", 0) >= publisher.MAX_ATTEMPTS
        ]
        if overCap:
            for t in overCap:
                storage.updateTargetStatus(
                    postId, t["platform"], t["accountId"], storage.STATUS_FAILED,
                    lastError=t.get("lastError") or "Exceeded retry attempts (reconciliation sweep)",
                )
                cappedTargets.append({"postId": postId, "platform": t["platform"], "accountId": t["accountId"]})
            storage.rollupParentStatus(postId)
        else:
            publisher.processPost(postId)
            retriedPostIds.append(postId)

    if retriedPostIds or cappedTargets:
        lines = []
        if retriedPostIds:
            lines.append(f"Retried {len(retriedPostIds)} overdue post(s): {', '.join(retriedPostIds)}")
        if cappedTargets:
            names = [f"{t['postId']}/{t['platform']}/{t['accountId']}" for t in cappedTargets]
            lines.append(f"Marked {len(cappedTargets)} target(s) failed (exceeded retry cap): {', '.join(names)}")
        alerts.sendAlert("Social reconcile: overdue work found", "\n".join(lines))

    stranded = _recoverStrandedContainers()
    stuckProcessingCount = len(stranded["resumed"]) + len(stranded["expired"])

    counts = storage.countHeartbeat(_isoSinceHours(24))
    alerts.sendHeartbeat(
        "Social scheduler daily heartbeat",
        f"pending={counts['pending']} published_last_24h={counts['publishedLast24h']} "
        f"failed={counts['failed']} stuck_processing={stuckProcessingCount}",
    )

    return {
        "ok": True,
        "overdueCount": len(overdueParents),
        "retried": retriedPostIds,
        "cappedFailed": cappedTargets,
        "resumedProcessing": stranded["resumed"],
        "expiredContainers": stranded["expired"],
        "heartbeat": counts,
    }


def handler(event, context):
    event = event or {}
    job = event.get("job", "reconcile")
    if job == "reconcile":
        return _reconcile()
    logger.error("maintenance handler: unknown job=%s", job)
    return {"ok": False, "error": f"unknown job: {job}"}
