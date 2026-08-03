"""Unit tests for social/scheduling.py (EventBridge Scheduler wrapper, phase 2).
No moto -- the scheduler boto3 client is mocked directly."""
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
    return ClientError(
        {"Error": {"Code": "ResourceNotFoundException", "Message": "gone"}},
        "DeleteSchedule",
    )


def _accessDenied():
    return ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "nope"}},
        "DeleteSchedule",
    )


# --- at() expression formatting ---------------------------------------------------


def test_scheduler_at_expression_has_no_trailing_z_and_no_offset():
    from social.scheduling import toSchedulerAtExpression

    expr = toSchedulerAtExpression("2026-08-02T15:04:00Z")
    assert expr == "at(2026-08-02T15:04:00)"
    assert "Z" not in expr
    assert "+" not in expr


def test_scheduler_at_expression_converts_from_z_suffix():
    from social.scheduling import toSchedulerAtExpression

    assert toSchedulerAtExpression("2026-08-02T15:04:00Z") == "at(2026-08-02T15:04:00)"


def test_scheduler_at_expression_converts_from_positive_offset_to_utc():
    from social.scheduling import toSchedulerAtExpression

    # +10:00 -> subtract 10 hours to reach UTC.
    assert toSchedulerAtExpression("2026-08-02T15:04:00+10:00") == "at(2026-08-02T05:04:00)"


def test_scheduler_at_expression_converts_from_negative_offset_to_utc():
    from social.scheduling import toSchedulerAtExpression

    # -05:00 -> add 5 hours to reach UTC (rolls into the next day).
    assert toSchedulerAtExpression("2026-08-02T22:04:00-05:00") == "at(2026-08-03T03:04:00)"


# --- immediate vs. scheduled guard -------------------------------------------------


def test_create_one_shot_past_dated_returns_immediate_no_schedule_created():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createOneShot("post1", "2020-01-01T00:00:00Z")

    assert result == {"immediate": True, "scheduleName": None}
    client.create_schedule.assert_not_called()


def test_create_one_shot_30_seconds_away_is_immediate():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createOneShot("post1", _isoFromNow(30))

    assert result["immediate"] is True
    client.create_schedule.assert_not_called()


def test_create_one_shot_future_creates_a_schedule():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "SCHEDULE_GROUP", "fus-social"), \
         patch.object(scheduling, "PUBLISHER_ARN", "arn:aws:lambda:us-east-1:123:function:fus-social-publisher"), \
         patch.object(scheduling, "SCHEDULER_ROLE_ARN", "arn:aws:iam::123:role/fus-social-scheduler-role"), \
         patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createOneShot("post1", _isoFromNow(600))

    assert result["immediate"] is False
    assert result["scheduleName"] == "social-post-post1"
    client.create_schedule.assert_called_once()
    kwargs = client.create_schedule.call_args.kwargs
    assert kwargs["Name"] == "social-post-post1"
    assert kwargs["GroupName"] == "fus-social"
    assert kwargs["ScheduleExpressionTimezone"] == "UTC"
    assert kwargs["FlexibleTimeWindow"] == {"Mode": "OFF"}
    assert kwargs["ActionAfterCompletion"] == "DELETE"
    assert kwargs["Target"]["Arn"] == "arn:aws:lambda:us-east-1:123:function:fus-social-publisher"
    assert kwargs["Target"]["RoleArn"] == "arn:aws:iam::123:role/fus-social-scheduler-role"
    assert kwargs["Target"]["Input"] == '{"postId": "post1"}'


# --- name sanitization --------------------------------------------------------------


def test_sanitize_schedule_name_replaces_disallowed_chars_and_truncates():
    from social.scheduling import sanitizeScheduleName

    assert sanitizeScheduleName("abc_DEF-123.xyz") == "abc_DEF-123.xyz"
    assert sanitizeScheduleName("has spaces/and:colons") == "has-spaces-and-colons"
    assert len(sanitizeScheduleName("x" * 100)) == 64


def test_schedule_name_for_post_id_with_uuid_hex():
    from social.scheduling import scheduleNameFor

    name = scheduleNameFor("abcdef0123456789abcdef0123456789")
    assert name.startswith("social-post-")
    assert len(name) <= 64


# --- cancelOneShot ------------------------------------------------------------------


def test_cancel_one_shot_swallows_resource_not_found():
    from social import scheduling

    client = MagicMock()
    client.delete_schedule.side_effect = _resourceNotFound()

    with patch.object(scheduling, "_client", return_value=client):
        scheduling.cancelOneShot("social-post-post1")  # must not raise


def test_cancel_one_shot_reraises_other_client_errors():
    from social import scheduling

    client = MagicMock()
    client.delete_schedule.side_effect = _accessDenied()

    with patch.object(scheduling, "_client", return_value=client):
        try:
            scheduling.cancelOneShot("social-post-post1")
            assert False, "expected ClientError to propagate"
        except ClientError as e:
            assert e.response["Error"]["Code"] == "AccessDeniedException"


def test_cancel_one_shot_no_op_on_empty_name():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        scheduling.cancelOneShot(None)
        scheduling.cancelOneShot("")

    client.delete_schedule.assert_not_called()


# --- rescheduleOneShot ---------------------------------------------------------------


def test_reschedule_one_shot_deletes_then_creates():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        result = scheduling.rescheduleOneShot("post1", _isoFromNow(600), oldScheduleName="social-post-old")

    client.delete_schedule.assert_called_once()
    assert client.delete_schedule.call_args.kwargs["Name"] == "social-post-old"
    client.create_schedule.assert_called_once()
    assert result["scheduleName"] == "social-post-post1"


def test_reschedule_one_shot_defaults_old_name_from_post_id():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "_client", return_value=client):
        scheduling.rescheduleOneShot("post1", _isoFromNow(600))

    assert client.delete_schedule.call_args.kwargs["Name"] == "social-post-post1"


# --- containerCheckScheduleNameFor (phase 5) -----------------------------------------


def test_container_check_schedule_name_is_deterministic_and_bounded():
    from social.scheduling import containerCheckScheduleNameFor

    name1 = containerCheckScheduleNameFor("post1", "instagram", "acct-a", 3)
    name2 = containerCheckScheduleNameFor("post1", "instagram", "acct-a", 3)
    assert name1 == name2
    assert len(name1) <= 64
    assert name1.startswith("social-chk-")


def test_container_check_schedule_name_differs_by_check_count():
    from social.scheduling import containerCheckScheduleNameFor

    name3 = containerCheckScheduleNameFor("post1", "instagram", "acct-a", 3)
    name4 = containerCheckScheduleNameFor("post1", "instagram", "acct-a", 4)
    assert name3 != name4


def test_container_check_schedule_name_stays_bounded_with_long_post_id_and_account_id():
    """Test matrix #12: social-chk-{postId}-{platform}-{accountId}-{n} would
    overflow 64 chars with realistic (long) identifiers -- the name must
    stay <= 64 and remain unique."""
    from social.scheduling import containerCheckScheduleNameFor

    longPostId = "a" * 40
    longAccountId = "b" * 40

    name = containerCheckScheduleNameFor(longPostId, "instagram", longAccountId, 5)
    assert len(name) <= 64

    # A different checkCount with the same (long) identifiers must still
    # produce a distinct name -- the human-readable part alone would be
    # truncated identically, so uniqueness depends on the hash suffix.
    otherName = containerCheckScheduleNameFor(longPostId, "instagram", longAccountId, 6)
    assert otherName != name
    assert len(otherName) <= 64

    # A different accountId (same length, same prefix after truncation)
    # must also stay distinct.
    otherAccountName = containerCheckScheduleNameFor(longPostId, "instagram", "c" * 40, 5)
    assert otherAccountName != name


# --- createContainerCheck -------------------------------------------------------------


def test_create_container_check_builds_a_one_shot_schedule():
    from social import scheduling

    client = MagicMock()
    with patch.object(scheduling, "SCHEDULE_GROUP", "fus-social"), \
         patch.object(scheduling, "PUBLISHER_ARN", "arn:aws:lambda:us-east-1:123:function:fus-social-publisher"), \
         patch.object(scheduling, "SCHEDULER_ROLE_ARN", "arn:aws:iam::123:role/fus-social-scheduler-role"), \
         patch.object(scheduling, "_client", return_value=client):
        result = scheduling.createContainerCheck("post1", "instagram", "acct-a", _isoFromNow(120), checkCount=3)

    client.create_schedule.assert_called_once()
    kwargs = client.create_schedule.call_args.kwargs
    assert kwargs["Name"] == result["scheduleName"]
    assert kwargs["GroupName"] == "fus-social"
    assert kwargs["ScheduleExpressionTimezone"] == "UTC"
    assert kwargs["FlexibleTimeWindow"] == {"Mode": "OFF"}
    assert kwargs["ActionAfterCompletion"] == "DELETE"
    assert kwargs["Target"]["Arn"] == "arn:aws:lambda:us-east-1:123:function:fus-social-publisher"
    assert kwargs["Target"]["RoleArn"] == "arn:aws:iam::123:role/fus-social-scheduler-role"

    import json
    payload = json.loads(kwargs["Target"]["Input"])
    assert payload == {
        "job": "checkContainer", "postId": "post1", "platform": "instagram",
        "accountId": "acct-a", "checkCount": 3,
    }
