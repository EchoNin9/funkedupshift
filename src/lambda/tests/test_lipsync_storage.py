"""Unit tests for lipsync/storage.py. No moto -- the DynamoDB Table
resource is mocked directly, matching social/storage.py's test conventions
(test_social_storage.py)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _conditionalCheckFailed():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException", "Message": "exists"}}, "PutItem")


def _flattenConditionExpression(expr):
    """Walk a boto3.dynamodb.conditions expression tree (And/Equals/LessThan/
    IsIn/...) down to leaf (attributeName, operator, value) tuples, so tests
    can assert on the *content* of a Condition without depending on object
    identity. Mirrors test_social_storage.py's identical helper."""
    parts = expr.get_expression()
    values = parts["values"]
    if parts.get("operator") == "AND":
        leaves = []
        for v in values:
            leaves.extend(_flattenConditionExpression(v))
        return leaves
    attr, val = values[0], values[1] if len(values) > 1 else None
    return [(attr.name, parts["operator"], val)]


def _item(jobId="job1", status="queued", **overrides):
    base = {
        "PK": f"JOB#{jobId}", "SK": "META", "jobId": jobId, "mode": "avatar", "status": status,
        "provider": "fal", "model": "fal-ai/kling-video/ai-avatar/v2/pro",
        "createdAt": "2026-08-16T12:00:00.000Z", "updatedAt": "2026-08-16T12:00:00.000Z",
    }
    base.update(overrides)
    return base


# --- createJob -----------------------------------------------------------------


def test_create_job_writes_expected_item_shape():
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        item = storage.createJob(
            jobId="job1", mode="avatar", provider="fal", model="fal-ai/kling-video/ai-avatar/v2/pro",
            audioKey="uploads/u/audio/a.wav", createdBy="user-123", consentAttested=True,
            imageKey="uploads/u/image/i.jpg",
        )

    table.put_item.assert_called_once()
    written = table.put_item.call_args.kwargs["Item"]
    assert written["PK"] == "JOB#job1"
    assert written["SK"] == "META"
    assert written["status"] == storage.STATUS_QUEUED
    assert written["statusKey"] == "STATUS#queued"
    assert written["mode"] == "avatar"
    assert written["imageKey"] == "uploads/u/image/i.jpg"
    assert written["videoKey"] == ""
    assert written["audioKey"] == "uploads/u/audio/a.wav"
    assert written["consentAttested"] is True
    assert written["checkCount"] == 0
    assert written["providerJobId"] == ""
    assert written["outputKey"] == ""
    assert written["prompt"] == ""  # not passed -- defaults to empty string, not omitted
    assert "durationSec" not in written  # omitted until completion, see storage.py's docstring
    assert isinstance(written["expiresAt"], int)
    assert item == written


def test_create_job_stores_prompt_when_given():
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.createJob(
            jobId="job1", mode="avatar", provider="fal", model="fal-ai/infinitalk",
            audioKey="uploads/u/audio/a.wav", createdBy="user-123", consentAttested=True,
            imageKey="uploads/u/image/i.jpg", prompt="a robot waving hello",
        )

    written = table.put_item.call_args.kwargs["Item"]
    assert written["prompt"] == "a robot waving hello"


def test_create_job_expires_at_is_roughly_90_days_out():
    from datetime import datetime, timedelta, timezone
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.createJob(
            jobId="job1", mode="relip", provider="fal", model="veed/lipsync",
            audioKey="a", createdBy="u", consentAttested=True, videoKey="v",
        )

    expiresAt = table.put_item.call_args.kwargs["Item"]["expiresAt"]
    expected = (datetime.now(timezone.utc) + timedelta(days=90)).timestamp()
    assert abs(expiresAt - expected) < 5


def test_create_job_conditional_write_blocks_duplicate_job_id():
    from lipsync import storage

    table = MagicMock()
    table.put_item.side_effect = _conditionalCheckFailed()

    with patch.object(storage, "_tbl", return_value=table):
        with pytest.raises(storage.JobAlreadyExistsError):
            storage.createJob(
                jobId="dup", mode="avatar", provider="fal", model="m", audioKey="a",
                createdBy="u", consentAttested=True, imageKey="i",
            )
    assert table.put_item.call_args.kwargs["ConditionExpression"] == "attribute_not_exists(PK)"


def test_get_job_returns_item_or_none():
    from lipsync import storage

    table = MagicMock()
    table.get_item.return_value = {"Item": _item()}
    with patch.object(storage, "_tbl", return_value=table):
        assert storage.getJob("job1")["jobId"] == "job1"

    table.get_item.return_value = {}
    with patch.object(storage, "_tbl", return_value=table):
        assert storage.getJob("missing") is None


# --- transitionStatus: the status-machine primitive ------------------------------


@pytest.mark.parametrize(
    "fromStatus,toStatus",
    [
        ("queued", "submitting"),
        ("submitting", "processing"),
        ("submitting", "failed"),
        ("processing", "processing"),  # checkCount self-transition
        ("processing", "completed"),
        ("processing", "failed"),
        ("queued", "cancelled"),
        ("submitting", "cancelled"),
        ("processing", "cancelled"),
    ],
)
def test_transition_status_every_legal_transition_succeeds(fromStatus, toStatus):
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        ok = storage.transitionStatus("job1", fromStatus, toStatus)

    assert ok is True
    kwargs = table.update_item.call_args.kwargs
    leaves = _flattenConditionExpression(kwargs["ConditionExpression"])
    assert ("status", "=", fromStatus) in leaves
    assert kwargs["ExpressionAttributeValues"][":s"] == toStatus


@pytest.mark.parametrize(
    "fromStatus,toStatus",
    [
        ("queued", "processing"),  # can't skip submitting
        ("queued", "completed"),
        ("completed", "processing"),  # terminal -> anything is illegal
        ("failed", "queued"),
        ("cancelled", "processing"),
    ],
)
def test_transition_status_illegal_transition_rejected_by_conditional_write(fromStatus, toStatus):
    """The DynamoDB conditional write is what actually enforces legality --
    "illegal" here means the job's CURRENT status (simulated by the
    ConditionalCheckFailedException below) doesn't match `fromStatus`, so
    the write is rejected regardless of what toStatus was requested."""
    from lipsync import storage

    table = MagicMock()
    table.update_item.side_effect = _conditionalCheckFailed()
    with patch.object(storage, "_tbl", return_value=table):
        ok = storage.transitionStatus("job1", fromStatus, toStatus)

    assert ok is False


def test_transition_status_reraises_non_conditional_errors():
    from lipsync import storage

    table = MagicMock()
    table.update_item.side_effect = ClientError(
        {"Error": {"Code": "ProvisionedThroughputExceededException", "Message": "x"}}, "UpdateItem",
    )
    with patch.object(storage, "_tbl", return_value=table):
        with pytest.raises(ClientError):
            storage.transitionStatus("job1", "queued", "submitting")


def test_transition_status_sets_status_key_for_non_terminal_target():
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.transitionStatus("job1", "queued", "submitting")

    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeValues"][":sk"] == "STATUS#submitting"
    assert "REMOVE" not in kwargs["UpdateExpression"]


@pytest.mark.parametrize("terminalStatus", ["completed", "failed", "cancelled"])
def test_transition_status_removes_status_key_for_terminal_target(terminalStatus):
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.transitionStatus("job1", "processing", terminalStatus)

    kwargs = table.update_item.call_args.kwargs
    assert "REMOVE statusKey" in kwargs["UpdateExpression"]
    assert ":sk" not in kwargs["ExpressionAttributeValues"]


def test_transition_status_extra_fields_are_aliased_and_set():
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.transitionStatus(
            "job1", "processing", "completed", outputKey="outputs/job1/job1.mp4", durationSec=12.5,
        )

    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeNames"]["#outputKey"] == "outputKey"
    assert kwargs["ExpressionAttributeValues"][":outputKey"] == "outputs/job1/job1.mp4"
    assert kwargs["ExpressionAttributeValues"][":durationSec"] == 12.5
    assert "#outputKey = :outputKey" in kwargs["UpdateExpression"]


def test_transition_status_float_fields_are_converted_to_decimal():
    """boto3's Table resource raises 'Float types are not supported' on a
    raw Python float -- a MagicMock table would never catch that (it never
    touches boto3's real serializer), so this asserts the VALUE TYPE
    directly, not just numeric equality (a bare float would also compare
    equal to 12.5 and pass a weaker assertion, defeating the point)."""
    from decimal import Decimal
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.transitionStatus("job1", "processing", "completed", durationSec=12.5)

    value = table.update_item.call_args.kwargs["ExpressionAttributeValues"][":durationSec"]
    assert isinstance(value, Decimal)
    assert value == Decimal("12.5")


def test_transition_status_int_fields_are_left_as_int_not_converted():
    """Only float needs the Decimal conversion -- boto3 already accepts a
    plain int (checkCount) natively, and converting it too would just be
    unnecessary churn."""
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.transitionStatus("job1", "processing", "processing", checkCount=4)

    value = table.update_item.call_args.kwargs["ExpressionAttributeValues"][":checkCount"]
    assert value == 4
    assert isinstance(value, int)


def test_transition_status_processing_self_transition_persists_check_count():
    """A duplicate scheduler firing races a live one: both attempt
    processing->processing with the SAME conditional guard, so only one can
    land -- this is what prevents a double checkStatus call from silently
    corrupting checkCount."""
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        ok = storage.transitionStatus("job1", "processing", "processing", checkCount=4)

    assert ok is True
    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeValues"][":checkCount"] == 4
    # Still non-terminal -> statusKey stays set (not removed).
    assert "REMOVE" not in kwargs["UpdateExpression"]


def test_reset_stuck_submitting_is_a_submitting_to_queued_transition():
    from lipsync import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        ok = storage.resetStuckSubmitting("job1")

    assert ok is True
    kwargs = table.update_item.call_args.kwargs
    leaves = _flattenConditionExpression(kwargs["ConditionExpression"])
    assert ("status", "=", "submitting") in leaves
    assert kwargs["ExpressionAttributeValues"][":s"] == "queued"


# --- cancelJob -------------------------------------------------------------------


@pytest.mark.parametrize("status", ["queued", "submitting", "processing"])
def test_cancel_job_succeeds_from_every_non_terminal_status(status):
    from lipsync import storage

    table = MagicMock()
    table.get_item.return_value = {"Item": _item(status="cancelled")}
    with patch.object(storage, "_tbl", return_value=table):
        result = storage.cancelJob("job1")

    assert result["status"] == "cancelled"
    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeValues"][":s"] == storage.STATUS_CANCELLED
    assert "REMOVE statusKey" in kwargs["UpdateExpression"]


def test_cancel_job_already_terminal_returns_false_not_found_disambiguated():
    from lipsync import storage

    table = MagicMock()
    table.update_item.side_effect = _conditionalCheckFailed()
    table.get_item.return_value = {"Item": _item(status="completed")}  # exists, just terminal
    with patch.object(storage, "_tbl", return_value=table):
        result = storage.cancelJob("job1")

    assert result is False


def test_cancel_job_not_found_returns_none():
    from lipsync import storage

    table = MagicMock()
    table.update_item.side_effect = _conditionalCheckFailed()
    table.get_item.return_value = {}  # no Item -> doesn't exist
    with patch.object(storage, "_tbl", return_value=table):
        result = storage.cancelJob("missing")

    assert result is None


# --- listJobs ----------------------------------------------------------------------


def test_list_jobs_sorted_newest_first():
    from lipsync import storage

    items = [
        _item("job1", createdAt="2026-08-16T10:00:00.000Z"),
        _item("job2", createdAt="2026-08-16T12:00:00.000Z"),
        _item("job3", createdAt="2026-08-16T11:00:00.000Z"),
    ]
    table = MagicMock()
    table.scan.return_value = {"Items": items}
    with patch.object(storage, "_tbl", return_value=table):
        jobs, cursor = storage.listJobs()

    assert [j["jobId"] for j in jobs] == ["job2", "job3", "job1"]
    assert cursor is None


def test_list_jobs_filters_by_status():
    from lipsync import storage

    table = MagicMock()
    table.scan.return_value = {"Items": [_item("job1", status="completed")]}
    with patch.object(storage, "_tbl", return_value=table):
        storage.listJobs(status="completed")

    kwargs = table.scan.call_args.kwargs
    leaves = _flattenConditionExpression(kwargs["FilterExpression"])
    assert ("status", "=", "completed") in leaves


def test_list_jobs_paginates_scan_then_applies_limit_and_cursor():
    from lipsync import storage

    items = [_item(f"job{i}", createdAt=f"2026-08-16T{10 + i:02d}:00:00.000Z") for i in range(5)]
    table = MagicMock()
    table.scan.side_effect = [
        {"Items": items[:3], "LastEvaluatedKey": {"PK": "x"}},
        {"Items": items[3:]},
    ]
    with patch.object(storage, "_tbl", return_value=table):
        firstPage, cursor = storage.listJobs(limit=2)

    assert table.scan.call_count == 2
    # newest-first across all 5 items: job4, job3, job2, job1, job0
    assert [j["jobId"] for j in firstPage] == ["job4", "job3"]
    assert cursor == "job3"


def test_list_jobs_cursor_resumes_after_the_given_job():
    from lipsync import storage

    items = [_item(f"job{i}", createdAt=f"2026-08-16T{10 + i:02d}:00:00.000Z") for i in range(5)]
    table = MagicMock()
    table.scan.return_value = {"Items": items}
    with patch.object(storage, "_tbl", return_value=table):
        page, cursor = storage.listJobs(limit=2, cursor="job3")

    assert [j["jobId"] for j in page] == ["job2", "job1"]
    assert cursor == "job1"


def test_list_jobs_no_more_pages_cursor_is_none():
    from lipsync import storage

    items = [_item("job1", createdAt="2026-08-16T10:00:00.000Z")]
    table = MagicMock()
    table.scan.return_value = {"Items": items}
    with patch.object(storage, "_tbl", return_value=table):
        page, cursor = storage.listJobs(limit=25)

    assert len(page) == 1
    assert cursor is None


# --- findStuckJobs -----------------------------------------------------------------


def test_find_stuck_jobs_queries_all_three_non_terminal_status_keys():
    from lipsync import storage

    table = MagicMock()
    table.query.return_value = {"Items": []}
    with patch.object(storage, "_tbl", return_value=table):
        storage.findStuckJobs(45)

    assert table.query.call_count == 3
    queriedStatusKeys = set()
    for call in table.query.call_args_list:
        assert call.kwargs["IndexName"] == "byStatusTime"
        leaves = _flattenConditionExpression(call.kwargs["KeyConditionExpression"])
        leafByAttr = {name: (op, val) for name, op, val in leaves}
        queriedStatusKeys.add(leafByAttr["statusKey"][1])
        assert leafByAttr["updatedAt"][0] == "<"
    assert queriedStatusKeys == {"STATUS#queued", "STATUS#submitting", "STATUS#processing"}


def test_find_stuck_jobs_ignores_terminal_jobs_by_construction():
    """Terminal jobs never carry a statusKey at all (removed on transition,
    see transitionStatus), so they cannot appear in a byStatusTime query
    result regardless of how stale updatedAt is -- this test documents that
    invariant by asserting the query is scoped to non-terminal statusKeys
    only, never e.g. STATUS#completed."""
    from lipsync import storage

    table = MagicMock()
    table.query.return_value = {"Items": []}
    with patch.object(storage, "_tbl", return_value=table):
        storage.findStuckJobs(45)

    for call in table.query.call_args_list:
        leaves = _flattenConditionExpression(call.kwargs["KeyConditionExpression"])
        leafByAttr = {name: (op, val) for name, op, val in leaves}
        assert leafByAttr["statusKey"][1] not in (
            "STATUS#completed", "STATUS#failed", "STATUS#cancelled",
        )


def test_find_stuck_jobs_paginates_each_status_query():
    from lipsync import storage

    table = MagicMock()
    table.query.side_effect = [
        {"Items": [{"jobId": "a"}], "LastEvaluatedKey": {"PK": "x"}},
        {"Items": [{"jobId": "b"}]},
        {"Items": [{"jobId": "c"}]},
        {"Items": [{"jobId": "d"}]},
    ]
    with patch.object(storage, "_tbl", return_value=table):
        found = storage.findStuckJobs(45)

    assert {j["jobId"] for j in found} == {"a", "b", "c", "d"}


# --- countByStatus -------------------------------------------------------------------


def test_count_by_status_tallies_every_known_status():
    from lipsync import storage

    items = [
        _item("j1", status="queued"), _item("j2", status="processing"),
        _item("j3", status="processing"), _item("j4", status="completed"),
        _item("j5", status="cancelled"),
    ]
    table = MagicMock()
    table.scan.return_value = {"Items": items}
    with patch.object(storage, "_tbl", return_value=table):
        counts = storage.countByStatus()

    assert counts["queued"] == 1
    assert counts["processing"] == 2
    assert counts["completed"] == 1
    assert counts["cancelled"] == 1
    assert counts["submitting"] == 0
    assert counts["failed"] == 0


def test_count_by_status_paginates():
    from lipsync import storage

    table = MagicMock()
    table.scan.side_effect = [
        {"Items": [_item("j1", status="queued")], "LastEvaluatedKey": {"PK": "x"}},
        {"Items": [_item("j2", status="queued")]},
    ]
    with patch.object(storage, "_tbl", return_value=table):
        counts = storage.countByStatus()

    assert counts["queued"] == 2
    assert table.scan.call_count == 2


# --- status-set invariants -----------------------------------------------------------


def test_non_terminal_and_terminal_status_sets_are_disjoint_and_complete():
    from lipsync import storage

    assert storage.NON_TERMINAL_STATUSES & storage.TERMINAL_STATUSES == set()
    assert storage.NON_TERMINAL_STATUSES | storage.TERMINAL_STATUSES == storage.ALL_STATUSES
    assert storage.ALL_STATUSES == {"queued", "submitting", "processing", "completed", "failed", "cancelled"}
