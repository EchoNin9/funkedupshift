"""
EventBridge Scheduler wrapper for one-shot lipsync poll-check invocations.

Mirrors social/scheduling.py's container-check pattern (createContainerCheck)
with one structural difference: docs/lipsync-design.md's backoff schedule
(15s, 15s, 30s, 30s, 60s, 60s, then 120s -- see runner.py's BACKOFF_SCHEDULE)
starts BELOW EventBridge Scheduler's 1-minute granularity floor. Social's
container-check interval is always >= 60s (CHECK_AFTER_SEC_FAST = 60), so it
never had to handle this; here, createCheck itself implements the same
immediate/schedule-nothing guard social/scheduling.py's ONE-SHOT POST
scheduling (createOneShot) already has via MIN_LEAD_SECONDS -- see the
design doc's "Sub-60s lead times schedule nothing and check inline" note.
When createCheck returns immediate=True, the caller (runner.checkJob) must
perform the next check right now, in-process, instead of waiting for a
schedule that was never created.
"""
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone

from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SCHEDULE_GROUP = os.environ.get("LIPSYNC_SCHEDULE_GROUP", "")
RUNNER_ARN = os.environ.get("LIPSYNC_RUNNER_ARN", "")
SCHEDULER_ROLE_ARN = os.environ.get("LIPSYNC_SCHEDULER_ROLE_ARN", "")

# EventBridge Scheduler's minimum granularity is 1 minute (same fact
# social/scheduling.py documents) -- below this, createCheck reports
# immediate=True instead of attempting (and failing, or silently rounding)
# a sub-minute schedule.
MIN_LEAD_SECONDS = 60

SCHEDULE_NAME_MAX = 64
_NAME_DISALLOWED_RE = re.compile(r"[^0-9a-zA-Z\-_.]")

# lipsync-chk-{jobId}-{checkCount} can overflow the 64-char cap once jobId is
# a realistic uuid4 hex -- same truncate-plus-stable-hash-suffix trick as
# social/scheduling.py's containerCheckScheduleNameFor, see that function's
# comment for the full rationale.
_CHK_PREFIX = "lipsync-chk-"
_CHK_HASH_LEN = 10

_scheduler = None


def _client():
    global _scheduler
    if _scheduler is None:
        import boto3
        _scheduler = boto3.client("scheduler")
    return _scheduler


def sanitizeScheduleName(raw):
    """EventBridge Scheduler names allow [0-9a-zA-Z-_.], max 64 chars."""
    cleaned = _NAME_DISALLOWED_RE.sub("-", raw)
    return cleaned[:SCHEDULE_NAME_MAX]


def _checkHashSuffix(jobId, checkCount):
    raw = f"{jobId}:{checkCount}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:_CHK_HASH_LEN]


def checkScheduleNameFor(jobId, checkCount):
    suffix = _checkHashSuffix(jobId, checkCount)
    maxHumanLen = SCHEDULE_NAME_MAX - len(_CHK_PREFIX) - len(suffix) - 1  # -1 for the joining "-"
    human = sanitizeScheduleName(f"{jobId}-{checkCount}")[:max(maxHumanLen, 0)]
    name = f"{_CHK_PREFIX}{human}-{suffix}" if human else f"{_CHK_PREFIX}{suffix}"
    return name[:SCHEDULE_NAME_MAX]


def _parseIsoToUtc(iso):
    s = iso.replace("Z", "+00:00") if iso.endswith("Z") else iso
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def toSchedulerAtExpression(iso):
    """'at(YYYY-MM-DDTHH:MM:SS)' -- no trailing Z, no offset (Scheduler's
    at() expression rejects both; ScheduleExpressionTimezone="UTC" below
    supplies the timezone instead). Same convention as
    social/scheduling.py's toSchedulerAtExpression."""
    dt = _parseIsoToUtc(iso)
    return f"at({dt.strftime('%Y-%m-%dT%H:%M:%S')})"


def createCheck(jobId, checkAtIso, checkCount):
    """Create a one-shot schedule that invokes the runner Lambda at
    `checkAtIso` to perform poll check #checkCount. Returns
    {"immediate": bool, "scheduleName": str|None} -- immediate=True means
    checkAtIso is under MIN_LEAD_SECONDS away, so no schedule was created
    and the caller must perform the check right now instead."""
    dt = _parseIsoToUtc(checkAtIso)
    now = datetime.now(timezone.utc)
    leadSeconds = (dt - now).total_seconds()

    if leadSeconds < MIN_LEAD_SECONDS:
        return {"immediate": True, "scheduleName": None}

    name = checkScheduleNameFor(jobId, checkCount)
    _client().create_schedule(
        Name=name,
        GroupName=SCHEDULE_GROUP,
        ScheduleExpression=toSchedulerAtExpression(checkAtIso),
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        ActionAfterCompletion="DELETE",
        Target={
            "Arn": RUNNER_ARN,
            "RoleArn": SCHEDULER_ROLE_ARN,
            "Input": json.dumps({"job": "check", "jobId": jobId, "checkCount": checkCount}),
        },
    )
    return {"immediate": False, "scheduleName": name}


def cancelCheck(scheduleName):
    """Delete a one-shot check schedule. Tolerates ResourceNotFoundException
    -- a schedule that already fired self-deletes (ActionAfterCompletion=
    DELETE), so 'already gone' is a normal, non-error outcome. Not currently
    called anywhere: the frozen data model has no field to look up a
    pending check's schedule name from a job record, and leaving an
    already-cancelled job's future check schedule to fire harmlessly is
    fine by design -- checkJob's own `status != processing` guard makes
    that firing a no-op (see storage.transitionStatus's docstring on "cancel
    wins"). Kept for symmetry/testability and as the natural place a future
    cleanup path would hook in."""
    if not scheduleName:
        return
    try:
        _client().delete_schedule(Name=scheduleName, GroupName=SCHEDULE_GROUP)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            return
        raise
