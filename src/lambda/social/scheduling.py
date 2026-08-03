"""
EventBridge Scheduler wrapper for one-shot social post publish schedules.

One schedule per post, named social-post-{postId}, created/deleted at RUNTIME
via boto3 (NOT declared as aws_scheduler_schedule Terraform resources -- see
infra/social.tf aws_scheduler_schedule_group.social). A fired schedule
self-deletes (ActionAfterCompletion=DELETE), so cancelOneShot tolerates
ResourceNotFoundException.
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

SCHEDULE_GROUP = os.environ.get("SOCIAL_SCHEDULE_GROUP", "")
PUBLISHER_ARN = os.environ.get("SOCIAL_PUBLISHER_ARN", "")
SCHEDULER_ROLE_ARN = os.environ.get("SOCIAL_SCHEDULER_ROLE_ARN", "")

# EventBridge Scheduler's minimum granularity is 1 minute; publishing "now"
# instead of scheduling avoids a create_schedule call for a target time that
# is already effectively immediate.
MIN_LEAD_SECONDS = 60

SCHEDULE_NAME_MAX = 64
_NAME_DISALLOWED_RE = re.compile(r"[^0-9a-zA-Z\-_.]")

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


def scheduleNameFor(postId):
    return sanitizeScheduleName(f"social-post-{postId}")


# --- container-check schedule naming ------------------------------------------
#
# social-chk-{postId}-{platform}-{accountId}-{checkCount} can overflow the
# 64-char cap once postId/accountId are realistic (e.g. UUIDs) --
# sanitizeScheduleName only sanitizes, it doesn't dedupe after truncating, so
# two different (postId, platform, accountId, checkCount) tuples that agree
# on their first N chars would collide. Instead: truncate the human-readable
# part and always append a short stable sha256-derived suffix, so the full
# name stays deterministic, unique per tuple, and <= 64 chars.
_CHK_PREFIX = "social-chk-"
_CHK_HASH_LEN = 10


def _containerCheckHashSuffix(postId, platform, accountId, checkCount):
    raw = f"{postId}:{platform}:{accountId}:{checkCount}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:_CHK_HASH_LEN]


def containerCheckScheduleNameFor(postId, platform, accountId, checkCount):
    suffix = _containerCheckHashSuffix(postId, platform, accountId, checkCount)
    maxHumanLen = SCHEDULE_NAME_MAX - len(_CHK_PREFIX) - len(suffix) - 1  # -1 for the joining "-"
    human = sanitizeScheduleName(f"{postId}-{platform}-{accountId}-{checkCount}")[:max(maxHumanLen, 0)]
    name = f"{_CHK_PREFIX}{human}-{suffix}" if human else f"{_CHK_PREFIX}{suffix}"
    return name[:SCHEDULE_NAME_MAX]


def _parseIsoToUtc(scheduledAt):
    s = scheduledAt.replace("Z", "+00:00") if scheduledAt.endswith("Z") else scheduledAt
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def toSchedulerAtExpression(scheduledAt):
    """'at(YYYY-MM-DDTHH:MM:SS)' -- NO trailing Z, no offset. Scheduler's
    at() expression rejects a 'Z' suffix or any timezone offset; the
    wall-clock value is interpreted using ScheduleExpressionTimezone (we
    always pass "UTC"), so the datetime must already be converted to UTC
    before this formatting step strips tzinfo."""
    dt = _parseIsoToUtc(scheduledAt)
    return f"at({dt.strftime('%Y-%m-%dT%H:%M:%S')})"


def createOneShot(postId, scheduledAt):
    """Create a one-shot EventBridge Scheduler schedule that invokes the
    social publisher Lambda at `scheduledAt` (ISO-8601, any offset/Z).

    Returns {"immediate": bool, "scheduleName": str|None}. immediate=True
    means scheduledAt is already in the past or under MIN_LEAD_SECONDS away
    -- the caller should publish synchronously instead; no schedule is
    created in that case.
    """
    dt = _parseIsoToUtc(scheduledAt)
    now = datetime.now(timezone.utc)
    leadSeconds = (dt - now).total_seconds()

    if leadSeconds < MIN_LEAD_SECONDS:
        return {"immediate": True, "scheduleName": None}

    name = scheduleNameFor(postId)
    _client().create_schedule(
        Name=name,
        GroupName=SCHEDULE_GROUP,
        ScheduleExpression=toSchedulerAtExpression(scheduledAt),
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        ActionAfterCompletion="DELETE",
        Target={
            "Arn": PUBLISHER_ARN,
            "RoleArn": SCHEDULER_ROLE_ARN,
            "Input": json.dumps({"postId": postId}),
        },
    )
    return {"immediate": False, "scheduleName": name}


def createContainerCheck(postId, platform, accountId, checkAt, checkCount):
    """One-shot schedule mirroring createOneShot, but for resuming a pending
    (async-container) publish -- same group, FlexibleTimeWindow off,
    ActionAfterCompletion=DELETE, same publisher ARN target and scheduler
    role. Input payload routes the publisher handler to checkContainer
    instead of the normal postId-only publish path.

    Returns {"scheduleName": str}.
    """
    name = containerCheckScheduleNameFor(postId, platform, accountId, checkCount)
    _client().create_schedule(
        Name=name,
        GroupName=SCHEDULE_GROUP,
        ScheduleExpression=toSchedulerAtExpression(checkAt),
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        ActionAfterCompletion="DELETE",
        Target={
            "Arn": PUBLISHER_ARN,
            "RoleArn": SCHEDULER_ROLE_ARN,
            "Input": json.dumps({
                "job": "checkContainer",
                "postId": postId,
                "platform": platform,
                "accountId": accountId,
                "checkCount": checkCount,
            }),
        },
    )
    return {"scheduleName": name}


def cancelOneShot(scheduleName):
    """Delete a one-shot schedule. Tolerates ResourceNotFoundException -- a
    schedule that already fired self-deletes (ActionAfterCompletion=DELETE),
    so 'already gone' is a normal, non-error outcome here."""
    if not scheduleName:
        return
    try:
        _client().delete_schedule(Name=scheduleName, GroupName=SCHEDULE_GROUP)
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ResourceNotFoundException":
            return
        raise


def rescheduleOneShot(postId, newScheduledAt, oldScheduleName=None):
    """Delete-then-create -- used both for phase-3 IG-polling reschedules and
    for publisher retries. `oldScheduleName` defaults to the deterministic
    name derived from postId (the common case); pass it explicitly if the
    caller already knows a different name was stored."""
    cancelOneShot(oldScheduleName or scheduleNameFor(postId))
    return createOneShot(postId, newScheduledAt)
