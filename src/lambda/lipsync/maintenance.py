"""
Scheduled maintenance for the lipsync module: a reconciliation sweep (safety
net for a lost async runner invoke, or a lost/never-fired EventBridge check
schedule) plus a daily heartbeat so operational silence itself is visible.
Mirrors social/maintenance.py.
"""
import logging

from lipsync import alerts, runner, storage

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# docs/lipsync-design.md's Job lifecycle: "Daily reconciliation ... queries
# byStatusTime for non-terminal jobs older than 45 min, re-checks them
# idempotently".
DEFAULT_GRACE_MINUTES = 45


def _recoverStuckJobs(graceMinutes=DEFAULT_GRACE_MINUTES):
    """Resume every non-terminal job whose updatedAt is stale, dispatched by
    its CURRENT status -- each recovery path reuses the same idempotent
    entrypoint the live path uses (runner.submitJob / runner.checkJob), so
    there is exactly one place that owns "what happens on a submit" or
    "what happens on a check", not a second copy here."""
    stuck = storage.findStuckJobs(graceMinutes)
    resumedQueued, resumedSubmitting, resumedProcessing = [], [], []

    for job in stuck:
        jobId = job["jobId"]
        status = job["status"]

        if status == storage.STATUS_QUEUED:
            # The runner's original async invoke was likely lost entirely --
            # submitJob's own conditional write (queued->submitting) is the
            # guard against a live invocation racing this one.
            runner.submitJob(jobId)
            resumedQueued.append(jobId)

        elif status == storage.STATUS_SUBMITTING:
            # The runner died between claiming the job and calling
            # provider.submit() -- reset to `queued` (conditional; a no-op
            # if a live invocation already resolved it) before retrying, so
            # submitJob's own queued->submitting guard applies again.
            if storage.resetStuckSubmitting(jobId):
                runner.submitJob(jobId)
                resumedSubmitting.append(jobId)

        elif status == storage.STATUS_PROCESSING:
            # The EventBridge check schedule was likely lost -- resume
            # polling from wherever it left off. checkJob's own
            # `status != processing` guard and MAX_CHECKS ceiling apply
            # unchanged.
            runner.checkJob(jobId, job.get("checkCount") or 1)
            resumedProcessing.append(jobId)

    resumed = resumedQueued + resumedSubmitting + resumedProcessing
    if resumed:
        alerts.sendAlert(
            "Lipsync reconcile: stuck jobs resumed",
            f"queued={len(resumedQueued)} submitting={len(resumedSubmitting)} "
            f"processing={len(resumedProcessing)}: {', '.join(resumed)}",
        )
    return {
        "resumed": resumed,
        "resumedQueued": resumedQueued,
        "resumedSubmitting": resumedSubmitting,
        "resumedProcessing": resumedProcessing,
    }


def _reconcile(graceMinutes=DEFAULT_GRACE_MINUTES):
    recovery = _recoverStuckJobs(graceMinutes)
    counts = storage.countByStatus()

    # Heartbeat is sent unconditionally -- "whether or not anything was
    # found -- operational silence must itself be visible" (design doc).
    alerts.sendHeartbeat(
        "Lipsync scheduler daily heartbeat",
        " ".join(f"{status}={counts.get(status, 0)}" for status in sorted(storage.ALL_STATUSES))
        + f" stuck_resumed={len(recovery['resumed'])}",
    )

    return {"ok": True, **recovery, "counts": counts}


def handler(event, context):
    event = event or {}
    job = event.get("job", "reconcile")
    if job == "reconcile":
        return _reconcile()
    logger.error("lipsync maintenance handler: unknown job=%s", job)
    return {"ok": False, "error": f"unknown job: {job}"}
