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


def _isoNowUtc():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _isoSinceHours(hours):
    when = datetime.now(timezone.utc) - timedelta(hours=hours)
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


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

    counts = storage.countHeartbeat(_isoSinceHours(24))
    alerts.sendHeartbeat(
        "Social scheduler daily heartbeat",
        f"pending={counts['pending']} published_last_24h={counts['publishedLast24h']} failed={counts['failed']}",
    )

    return {
        "ok": True,
        "overdueCount": len(overdueParents),
        "retried": retriedPostIds,
        "cappedFailed": cappedTargets,
        "heartbeat": counts,
    }


def handler(event, context):
    event = event or {}
    job = event.get("job", "reconcile")
    if job == "reconcile":
        return _reconcile()
    logger.error("maintenance handler: unknown job=%s", job)
    return {"ok": False, "error": f"unknown job: {job}"}
