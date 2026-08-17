"""
Lambda entry point: submitJob (claims a `queued` job, calls the provider,
moves it to `processing`) and checkJob (polls the provider, advances through
the backoff schedule, and lands the job in a terminal state). This is the
"submit to a third party, get a job id, poll until done" worker -- the
self-scheduling poll pattern already proven in social/publisher.py, adapted
for a single-item (no fan-out) job and a sub-minute-capable backoff (see
scheduling.py's module docstring for why createCheck needs its own
immediate guard that social's container-check scheduling never needed).

Invocation shapes (see routes._invokeRunnerAsync and scheduling.createCheck):
    {"jobId": "..."}                                   -> submitJob path
    {"job": "check", "jobId": "...", "checkCount": N}  -> checkJob path
"""
import logging
from datetime import datetime, timedelta, timezone

from lipsync import alerts, media, scheduling, storage
from lipsync.providers import (
    STATE_COMPLETED,
    STATE_IN_PROGRESS,
    STATE_IN_QUEUE,
    ProviderError,
    UnknownProviderError,
    ValidationError,
    getProvider,
)
from lipsync.secrets import SecretNotFoundError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# docs/lipsync-design.md's Job lifecycle: "Backoff: 15s, 15s, 30s, 30s, 60s,
# 60s, then 120s, MAX_CHECKS = 25 (~30 min ceiling)."
BACKOFF_SCHEDULE = [15, 15, 30, 30, 60, 60, 120]
MAX_CHECKS = 25

# design doc's fal.ai integration notes: "Generate presigned S3 GET URLs
# (TTL 3600s) and hand those to fal."
INPUT_URL_EXPIRES_SEC = media.INPUT_URL_EXPIRES_IN


def backoffSeconds(checkCount):
    """checkCount is 1-based (the check about to be scheduled). Returns the
    documented interval: 15s, 15s, 30s, 30s, 60s, 60s, then 120s for every
    check after the 7th -- BACKOFF_SCHEDULE[6] repeats for all higher
    checkCounts rather than the list growing further."""
    idx = min(checkCount - 1, len(BACKOFF_SCHEDULE) - 1)
    return BACKOFF_SCHEDULE[idx]


def _isoInSeconds(seconds):
    when = datetime.now(timezone.utc) + timedelta(seconds=max(seconds or 0, 0))
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _userSafe(e):
    """Never let a raw exception (or a stack trace) reach the job record's
    `error` field, which IS shown to the client verbatim (JobDetail.tsx).
    ProviderError/ValidationError/UnknownProviderError are already
    constructed to be safe (see providers/fal.py's _safeErrStr -- no
    response bodies or credentials are ever included), so they pass
    through as-is; anything else (including a missing/malformed SSM
    parameter) gets a generic, typed, non-leaking message."""
    if isinstance(e, SecretNotFoundError):
        return "Lipsync is not fully configured (missing credentials). Contact an administrator."
    if isinstance(e, (ProviderError, ValidationError, UnknownProviderError)):
        return str(e)
    return "An unexpected error occurred while generating this clip."


def _buildInputUrls(job):
    urls = {"audioUrl": media.presignGet(job["audioKey"], expiresIn=INPUT_URL_EXPIRES_SEC)}
    if job.get("imageKey"):
        urls["imageUrl"] = media.presignGet(job["imageKey"], expiresIn=INPUT_URL_EXPIRES_SEC)
    if job.get("videoKey"):
        urls["videoUrl"] = media.presignGet(job["videoKey"], expiresIn=INPUT_URL_EXPIRES_SEC)
    return urls


def _copyOutput(jobId, outputUrl):
    """Download fal's (temporary) output URL and re-upload it into our own
    bucket BEFORE the job is ever marked completed (design doc: "fal.ai
    output URLs are temporary... Copy the output into our own S3 bucket
    before marking the job completed."). Duration is re-measured from the
    copied bytes rather than trusted from fal's response -- see
    providers/fal.py's module docstring on why that field isn't reliably
    present for both models."""
    data = media.fetchExternalBytes(outputUrl)
    outputKey = media.outputKeyFor(jobId)
    media.putBytes(outputKey, data, contentType="video/mp4")
    durationSec = media.probeDurationSeconds(data, ".mp4")
    return outputKey, durationSec


# --- submit --------------------------------------------------------------------


def submitJob(jobId):
    job = storage.getJob(jobId)
    if job is None:
        logger.warning("submitJob: jobId=%s not found", jobId)
        return {"ok": False, "jobId": jobId, "error": "not found"}

    claimed = storage.transitionStatus(jobId, storage.STATUS_QUEUED, storage.STATUS_SUBMITTING)
    if not claimed:
        # Either a duplicate invocation already claimed this job, or the
        # user cancelled it before the runner ever got to it -- either way,
        # never double-submit to the provider.
        return {"ok": True, "jobId": jobId, "skipped": True, "reason": "not queued"}

    try:
        provider = getProvider(job["provider"])
        inputUrls = _buildInputUrls(job)
        result = provider.submit(job, inputUrls)
    except Exception as e:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception("submitJob: submit failed for jobId=%s", jobId)
        storage.transitionStatus(jobId, storage.STATUS_SUBMITTING, storage.STATUS_FAILED, error=_userSafe(e))
        alerts.sendAlert(f"Lipsync job {jobId} failed to submit", str(e))
        return {"ok": False, "jobId": jobId, "error": str(e)}

    moved = storage.transitionStatus(
        jobId, storage.STATUS_SUBMITTING, storage.STATUS_PROCESSING, providerJobId=result.providerJobId,
    )
    if not moved:
        # Cancelled while submit() was in flight -- cancel wins, no
        # resurrection: don't start polling a job the user already killed.
        return {"ok": True, "jobId": jobId, "skipped": True, "reason": "cancelled mid-submit"}

    return checkJob(jobId, checkCount=1)


# --- check -----------------------------------------------------------------------


def checkJob(jobId, checkCount):
    job = storage.getJob(jobId)
    if job is None:
        logger.warning("checkJob: jobId=%s not found", jobId)
        return {"ok": False, "jobId": jobId, "error": "not found"}

    if job["status"] != storage.STATUS_PROCESSING:
        # Already resolved by another path (terminal), or cancelled --
        # a duplicate/late schedule firing here is a harmless no-op.
        return {"ok": True, "jobId": jobId, "skipped": True, "status": job["status"]}

    try:
        provider = getProvider(job["provider"])
        result = provider.checkStatus(job)
    except Exception as e:  # noqa: BLE001 -- must never raise out of the handler
        logger.exception("checkJob: checkStatus failed for jobId=%s", jobId)
        storage.transitionStatus(jobId, storage.STATUS_PROCESSING, storage.STATUS_FAILED, error=_userSafe(e))
        alerts.sendAlert(f"Lipsync job {jobId} failed while checking status", str(e))
        return {"ok": False, "jobId": jobId, "error": str(e)}

    if result.state in (STATE_IN_QUEUE, STATE_IN_PROGRESS):
        return _handleStillRunning(jobId, checkCount)

    if result.state == STATE_COMPLETED:
        return _handleCompleted(jobId, result)

    # STATE_FAILED, or any state providers.checkStatus already normalised
    # to FAILED (an unrecognised status string, a malformed response, ...).
    storage.transitionStatus(
        jobId, storage.STATUS_PROCESSING, storage.STATUS_FAILED, error=result.error or "Generation failed.",
    )
    alerts.sendAlert(f"Lipsync job {jobId} failed", result.error or "")
    return {"ok": True, "jobId": jobId, "status": storage.STATUS_FAILED}


def _handleStillRunning(jobId, checkCount):
    if checkCount >= MAX_CHECKS:
        # This WAS the MAX_CHECKS-th check and it's still not done -- give
        # up rather than scheduling another one. statusKey is removed by
        # this transition (terminal status), so the reconciliation sweep
        # will not keep retrying it forever.
        storage.transitionStatus(
            jobId, storage.STATUS_PROCESSING, storage.STATUS_FAILED,
            error="Timed out waiting for the provider to finish generating this clip.",
        )
        alerts.sendAlert(f"Lipsync job {jobId} timed out", f"Exceeded MAX_CHECKS={MAX_CHECKS}")
        return {"ok": True, "jobId": jobId, "status": storage.STATUS_FAILED, "reason": "timeout"}

    nextCheckCount = checkCount + 1
    # Self-transition (processing -> processing) purely to persist
    # checkCount, but STILL conditional on the job still being `processing`
    # -- so a cancel that lands between checkStatus() returning and here
    # stops the loop immediately instead of scheduling yet another check.
    stillLive = storage.transitionStatus(
        jobId, storage.STATUS_PROCESSING, storage.STATUS_PROCESSING, checkCount=checkCount,
    )
    if not stillLive:
        return {"ok": True, "jobId": jobId, "skipped": True, "reason": "cancelled mid-check"}

    interval = backoffSeconds(nextCheckCount)
    outcome = scheduling.createCheck(jobId, _isoInSeconds(interval), nextCheckCount)
    if outcome["immediate"]:
        # Sub-60s backoff step -- EventBridge Scheduler can't express it, so
        # perform the next check right now instead of waiting (see
        # scheduling.py's module docstring). Bounded: BACKOFF_SCHEDULE only
        # stays under MIN_LEAD_SECONDS for its first few entries, so this
        # loop is naturally shallow, not unbounded recursion.
        return checkJob(jobId, nextCheckCount)
    return {"ok": True, "jobId": jobId, "status": storage.STATUS_PROCESSING, "scheduled": True}


def _handleCompleted(jobId, result):
    try:
        outputKey, durationSec = _copyOutput(jobId, result.outputUrl)
    except Exception as e:  # noqa: BLE001 -- must land in `failed`, never hang in `processing`
        logger.exception("checkJob: output copy failed for jobId=%s", jobId)
        storage.transitionStatus(
            jobId, storage.STATUS_PROCESSING, storage.STATUS_FAILED,
            error="Generation finished, but we couldn't retrieve the video.",
        )
        alerts.sendAlert(f"Lipsync job {jobId}: output copy failed", str(e))
        return {"ok": True, "jobId": jobId, "status": storage.STATUS_FAILED, "reason": "output copy failed"}

    fields = {"outputKey": outputKey}
    if durationSec is not None:
        fields["durationSec"] = durationSec
    moved = storage.transitionStatus(jobId, storage.STATUS_PROCESSING, storage.STATUS_COMPLETED, **fields)
    if not moved:
        # Cancelled in the narrow window between checkStatus() returning
        # COMPLETED and this write -- cancel wins; the copied output is
        # simply orphaned in S3 (cleaned up by the bucket's 90-day
        # lifecycle rule, see infra/lipsync.tf) rather than resurrecting a
        # cancelled job as completed.
        return {"ok": True, "jobId": jobId, "skipped": True, "reason": "cancelled before completion recorded"}
    return {"ok": True, "jobId": jobId, "status": storage.STATUS_COMPLETED}


# --- Lambda entrypoint -----------------------------------------------------------


def handler(event, context):
    event = event or {}
    jobId = event.get("jobId")
    if not jobId:
        logger.error("lipsync runner invoked without jobId: %s", event)
        return {"ok": False, "error": "jobId is required"}

    try:
        if event.get("job") == "check":
            return checkJob(jobId, event.get("checkCount", 1))
        return submitJob(jobId)
    except Exception as e:  # noqa: BLE001 -- last-resort guard, handler must not raise
        logger.exception("Unhandled error in lipsync runner for jobId=%s", jobId)
        alerts.sendAlert(f"Lipsync runner: unhandled error for job {jobId}", str(e))
        return {"ok": False, "jobId": jobId, "error": str(e)}
