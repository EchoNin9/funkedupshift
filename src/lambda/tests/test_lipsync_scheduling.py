"""Unit tests for lipsync/scheduling.py (EventBridge Scheduler wrapper).
No moto -- the scheduler boto3 client is mocked directly. Mirrors
social/scheduling.py's test conventions (test_social_scheduling.py)."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _isoFromNow(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _resourceNotFound():
    return ClientError({"Error": {"Code": "ResourceNotFoundException", "Message": "gone"}}, "DeleteSchedule")


def _accessDenied():
    return ClientError({"Error": {"Code": "AccessDeniedException", "Message": "nope"}}, "DeleteSchedule")


# --- at() expression formatting ---------------------------------------------------


def test_scheduler_at_expression_has_no_trailing_z_and_no_offset():
    from lipsync.scheduling import toSchedulerAtExpression

    expr = toSchedulerAtExpression("2026-08-16T15:04:00Z")
    assert expr == "at(2026-08-16T15:04:00)"
    assert "Z" not in expr
    assert "+" not in expr


def test_scheduler_at_expression_converts_positive_offset_to_utc():
    from lipsync.scheduling import toSchedulerAtExpression

    assert toSchedulerAtExpression("2026-08-16T15:04:00+10:00") == "at(2026-08-16T05:04:00)"


def test_scheduler_at_expression_converts_negative_offset_to_utc():
    from lipsync.scheduling import toSchedulerAtExpression

    assert toSchedulerAtExpression("2026-08-16T22:04:00-05:00") == "at(2026-08-17T03:04:00)"


# --- immediate / sub-60s guard (the piece social's container-check never needed) --


def test_create_check_under_min_lead_seconds_is_immediate_no_schedule_created():
    from lipsync import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createCheck("job1", _isoFromNow(15), checkCount=1)

    assert result == {"immediate": True, "scheduleName": None}
    client.create_schedule.assert_not_called()


def test_create_check_at_exactly_min_lead_seconds_creates_a_schedule():
    from lipsync import scheduling

    client = MagicMock()
    with patch.object(scheduling, "SCHEDULE_GROUP", "fus-lipsync"), \
         patch.object(scheduling, "RUNNER_ARN", "arn:aws:lambda:us-east-1:123:function:fus-lipsync-runner"), \
         patch.object(scheduling, "SCHEDULER_ROLE_ARN", "arn:aws:iam::123:role/fus-lipsync-scheduler-role"), \
         patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createCheck("job1", _isoFromNow(scheduling.MIN_LEAD_SECONDS + 5), checkCount=1)

    assert result["immediate"] is False
    client.create_schedule.assert_called_once()


def test_create_check_past_dated_is_immediate():
    from lipsync import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createCheck("job1", "2020-01-01T00:00:00Z", checkCount=1)

    assert result["immediate"] is True
    client.create_schedule.assert_not_called()


def test_create_check_future_creates_a_schedule_with_correct_target():
    from lipsync import scheduling

    client = MagicMock()
    with patch.object(scheduling, "SCHEDULE_GROUP", "fus-lipsync"), \
         patch.object(scheduling, "RUNNER_ARN", "arn:aws:lambda:us-east-1:123:function:fus-lipsync-runner"), \
         patch.object(scheduling, "SCHEDULER_ROLE_ARN", "arn:aws:iam::123:role/fus-lipsync-scheduler-role"), \
         patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createCheck("job1", _isoFromNow(600), checkCount=3)

    assert result["immediate"] is False
    assert result["scheduleName"] == scheduling.checkScheduleNameFor("job1", 3)
    kwargs = client.create_schedule.call_args.kwargs
    assert kwargs["GroupName"] == "fus-lipsync"
    assert kwargs["ScheduleExpressionTimezone"] == "UTC"
    assert kwargs["FlexibleTimeWindow"] == {"Mode": "OFF"}
    assert kwargs["ActionAfterCompletion"] == "DELETE"
    assert kwargs["Target"]["Arn"] == "arn:aws:lambda:us-east-1:123:function:fus-lipsync-runner"
    assert kwargs["Target"]["RoleArn"] == "arn:aws:iam::123:role/fus-lipsync-scheduler-role"

    import json
    payload = json.loads(kwargs["Target"]["Input"])
    assert payload == {"job": "check", "jobId": "job1", "checkCount": 3}


# --- name sanitization / bounding --------------------------------------------------


def test_sanitize_schedule_name_replaces_disallowed_chars_and_truncates():
    from lipsync.scheduling import sanitizeScheduleName

    assert sanitizeScheduleName("abc_DEF-123.xyz") == "abc_DEF-123.xyz"
    assert sanitizeScheduleName("has spaces/and:colons") == "has-spaces-and-colons"
    assert len(sanitizeScheduleName("x" * 100)) == 64


def test_check_schedule_name_is_deterministic_and_bounded():
    from lipsync.scheduling import checkScheduleNameFor

    name1 = checkScheduleNameFor("job1", 3)
    name2 = checkScheduleNameFor("job1", 3)
    assert name1 == name2
    assert len(name1) <= 64
    assert name1.startswith("lipsync-chk-")


def test_check_schedule_name_differs_by_check_count():
    from lipsync.scheduling import checkScheduleNameFor

    assert checkScheduleNameFor("job1", 3) != checkScheduleNameFor("job1", 4)


def test_check_schedule_name_stays_bounded_with_long_job_id():
    """A uuid4-hex jobId (32 chars) plus a large checkCount must still
    produce a <=64-char, unique name (same overflow risk
    social/scheduling.py's containerCheckScheduleNameFor test matrix #12
    covers for its own naming scheme)."""
    from lipsync.scheduling import checkScheduleNameFor

    longJobId = "a" * 32
    name = checkScheduleNameFor(longJobId, 25)
    assert len(name) <= 64

    otherCount = checkScheduleNameFor(longJobId, 24)
    assert otherCount != name
    assert len(otherCount) <= 64


# --- cancelCheck ---------------------------------------------------------------------


def test_cancel_check_swallows_resource_not_found():
    from lipsync import scheduling

    client = MagicMock()
    client.delete_schedule.side_effect = _resourceNotFound()

    with patch.object(scheduling, "_client", return_value=client):
        scheduling.cancelCheck("lipsync-chk-job1-1-abc123")  # must not raise


def test_cancel_check_reraises_other_client_errors():
    from lipsync import scheduling

    client = MagicMock()
    client.delete_schedule.side_effect = _accessDenied()

    with patch.object(scheduling, "_client", return_value=client):
        try:
            scheduling.cancelCheck("lipsync-chk-job1-1-abc123")
            assert False, "expected ClientError to propagate"
        except ClientError as e:
            assert e.response["Error"]["Code"] == "AccessDeniedException"


def test_cancel_check_no_op_on_empty_name():
    from lipsync import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        scheduling.cancelCheck(None)
        scheduling.cancelCheck("")

    client.delete_schedule.assert_not_called()
