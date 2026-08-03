"""Unit tests for social/storage.py (phase 2). No moto -- the DynamoDB Table
resource is mocked directly, matching the MagicMock/patch.object conventions
used elsewhere in this repo (see test_tools_shortener.py)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _conditionalCheckFailed():
    return ClientError(
        {"Error": {"Code": "ConditionalCheckFailedException", "Message": "exists"}},
        "PutItem",
    )


def _flattenConditionExpression(expr):
    """Walk a boto3.dynamodb.conditions expression tree (And/Equals/LessThan/...)
    down to leaf (attributeName, operator, value) tuples, so tests can assert
    on the *content* of a KeyConditionExpression without depending on its
    exact object identity."""
    parts = expr.get_expression()
    values = parts["values"]
    if parts.get("operator") == "AND":
        leaves = []
        for v in values:
            leaves.extend(_flattenConditionExpression(v))
        return leaves
    attr, val = values
    return [(attr.name, parts["operator"], val)]


# --- createPost ---------------------------------------------------------------


def test_create_post_writes_one_parent_and_n_target_items():
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.createPost(
            postId="post1",
            text="hello",
            mediaKeys=["uploads/u/post1/pic.jpg"],
            links=["https://example.com"],
            scheduledAt="2026-08-02T15:00:00Z",
            createdBy="user-123",
            targets=[
                {"platform": "bluesky", "accountId": "acct-a", "overrides": {}},
                {"platform": "bluesky", "accountId": "acct-b", "overrides": {"text": "b text"}},
            ],
        )

    assert table.put_item.call_count == 3  # 1 parent + 2 targets

    parentItem = table.put_item.call_args_list[0].kwargs["Item"]
    assert parentItem["PK"] == "POST#post1"
    assert parentItem["SK"] == "META"
    assert parentItem["status"] == storage.STATUS_PENDING
    assert parentItem["statusKey"] == "STATUS#pending"
    assert parentItem["mediaKeys"] == ["uploads/u/post1/pic.jpg"]
    assert parentItem["monthKey"] == "2026-08"

    targetItemA = table.put_item.call_args_list[1].kwargs["Item"]
    assert targetItemA["PK"] == "POST#post1"
    assert targetItemA["SK"] == "TARGET#bluesky#acct-a"
    assert targetItemA["status"] == storage.STATUS_PENDING
    assert targetItemA["attemptCount"] == 0

    targetItemB = table.put_item.call_args_list[2].kwargs["Item"]
    assert targetItemB["SK"] == "TARGET#bluesky#acct-b"
    assert targetItemB["overrides"] == {"text": "b text"}


def test_create_post_conditional_write_blocks_duplicate_post_id():
    from social import storage

    table = MagicMock()
    table.put_item.side_effect = _conditionalCheckFailed()

    with patch.object(storage, "_tbl", return_value=table):
        with pytest.raises(storage.PostAlreadyExistsError):
            storage.createPost(
                postId="dup", text="x", mediaKeys=[], links=[], scheduledAt="2026-08-02T15:00:00Z",
                createdBy="u", targets=[{"platform": "bluesky", "accountId": "a", "overrides": {}}],
            )

    # Only the parent put was attempted -- target items are never written
    # once the conditional parent write fails.
    table.put_item.assert_called_once()
    assert table.put_item.call_args.kwargs["ConditionExpression"] == "attribute_not_exists(PK)"


# --- monthKey -------------------------------------------------------------------


def test_month_key_derived_from_utc_date_not_naive_string_slice():
    from social import storage

    # Local wall-clock date is 2026-01-01, but the +05:00 offset means the
    # UTC instant falls on 2025-12-31 -- monthKey must reflect UTC, not a
    # naive slice of the literal string.
    assert storage._deriveMonthKey("2026-01-01T02:00:00+05:00") == "2025-12"
    assert storage._deriveMonthKey("2026-08-02T15:00:00Z") == "2026-08"


# --- statusKey lifecycle --------------------------------------------------------


def test_update_parent_status_sets_status_key_while_pending():
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.updateParentStatus("post1", storage.STATUS_PENDING)

    kwargs = table.update_item.call_args.kwargs
    assert ":sk" in kwargs["ExpressionAttributeValues"]
    assert kwargs["ExpressionAttributeValues"][":sk"] == "STATUS#pending"
    assert "REMOVE" not in kwargs["UpdateExpression"]


@pytest.mark.parametrize("status", ["publishing", "published", "failed", "cancelled", "partial"])
def test_update_parent_status_removes_status_key_on_non_pending(status):
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.updateParentStatus("post1", status)

    kwargs = table.update_item.call_args.kwargs
    assert "REMOVE statusKey" in kwargs["UpdateExpression"]
    assert ":sk" not in kwargs["ExpressionAttributeValues"]


# --- parent rollup ---------------------------------------------------------------


@pytest.mark.parametrize(
    "targetStatuses,expected",
    [
        (["published", "published"], "published"),
        (["failed", "failed"], "failed"),
        (["failed", "cancelled"], "failed"),
        (["published", "failed"], "partial"),
        (["published", "cancelled"], "partial"),
        (["pending", "published"], "publishing"),
        (["publishing"], "publishing"),
        ([], "pending"),
        # processing is non-terminal -- a mixed sync-published +
        # still-processing fan-out must stay "publishing", not resolve
        # early (test matrix #6).
        (["processing", "published"], "publishing"),
        (["processing"], "publishing"),
    ],
)
def test_derive_parent_status_rollup(targetStatuses, expected):
    from social import storage

    assert storage.deriveParentStatus(targetStatuses) == expected


def test_processing_is_not_a_terminal_target_status():
    from social import storage

    assert storage.STATUS_PROCESSING not in storage.TARGET_TERMINAL_STATUSES


def test_rollup_parent_status_queries_targets_and_persists_derived_status():
    from social import storage

    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {"PK": "POST#post1", "SK": "META", "postId": "post1"},
            {"PK": "POST#post1", "SK": "TARGET#bluesky#a", "status": "published"},
            {"PK": "POST#post1", "SK": "TARGET#bluesky#b", "status": "failed"},
        ]
    }

    with patch.object(storage, "_tbl", return_value=table):
        result = storage.rollupParentStatus("post1")

    assert result == "partial"
    update_kwargs = table.update_item.call_args.kwargs
    assert update_kwargs["ExpressionAttributeValues"][":s"] == "partial"


# --- findOverduePending -----------------------------------------------------------


def test_find_overdue_pending_queries_by_status_time_gsi_with_right_key_condition():
    from social import storage

    table = MagicMock()
    table.query.return_value = {"Items": []}

    with patch.object(storage, "_tbl", return_value=table):
        storage.findOverduePending("2026-08-02T12:00:00Z", graceMinutes=15)

    kwargs = table.query.call_args.kwargs
    assert kwargs["IndexName"] == "byStatusTime"

    leaves = _flattenConditionExpression(kwargs["KeyConditionExpression"])
    leafByAttr = {name: (op, val) for name, op, val in leaves}

    assert leafByAttr["statusKey"] == ("=", "STATUS#pending")
    op, cutoff = leafByAttr["scheduledAt"]
    assert op == "<"
    # 15 minutes before 12:00:00Z.
    assert cutoff == "2026-08-02T11:45:00.000Z"


# --- updateTargetStatus / incrementAttempt ----------------------------------------


def test_update_target_status_conditional_write_returns_false_on_condition_failure():
    from social import storage

    table = MagicMock()
    table.update_item.side_effect = _conditionalCheckFailed()

    with patch.object(storage, "_tbl", return_value=table):
        claimed = storage.updateTargetStatus(
            "post1", "bluesky", "a", storage.STATUS_PUBLISHING, expectedNotStatus=storage.STATUS_PUBLISHED
        )

    assert claimed is False


def test_update_target_status_success_returns_true_and_sets_fields():
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        claimed = storage.updateTargetStatus(
            "post1", "bluesky", "a", storage.STATUS_PUBLISHED, permalink="https://x", platformPostId="at://x"
        )

    assert claimed is True
    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeValues"][":permalink"] == "https://x"
    assert kwargs["ExpressionAttributeValues"][":platformPostId"] == "at://x"


def test_increment_attempt_returns_new_count():
    from social import storage

    table = MagicMock()
    table.update_item.return_value = {"Attributes": {"attemptCount": 2}}

    with patch.object(storage, "_tbl", return_value=table):
        newCount = storage.incrementAttempt("post1", "bluesky", "a")

    assert newCount == 2
    assert table.update_item.call_args.kwargs["UpdateExpression"] == "ADD attemptCount :one SET updatedAt = :u"


# --- setTargetContainer / markTargetProcessing (phase 5) --------------------------


def test_set_target_container_persists_container_id_without_changing_status():
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.setTargetContainer("post1", "instagram", "a", "container-123")

    kwargs = table.update_item.call_args.kwargs
    assert kwargs["Key"] == {"PK": "POST#post1", "SK": "TARGET#instagram#a"}
    assert kwargs["ExpressionAttributeValues"][":c"] == "container-123"
    assert "containerCreatedAt" in kwargs["UpdateExpression"]
    # Must not touch status -- this is a durability write, not a transition.
    assert "status" not in kwargs["UpdateExpression"].lower().replace("containercreatedat", "")


def test_mark_target_processing_sets_status_and_container_fields_no_status_key():
    """Anti-duplicate invariant (test matrix #5): a processing target must
    NOT carry statusKey. markTargetProcessing only ever touches the TARGET
    item, which never had statusKey to begin with (that field lives only on
    the parent META item) -- assert the update expression doesn't
    reference it, so a future edit can't accidentally add it."""
    from social import storage

    table = MagicMock()
    with patch.object(storage, "_tbl", return_value=table):
        storage.markTargetProcessing("post1", "instagram", "a", "container-123", checkCount=2)

    kwargs = table.update_item.call_args.kwargs
    assert kwargs["ExpressionAttributeValues"][":s"] == storage.STATUS_PROCESSING
    assert kwargs["ExpressionAttributeValues"][":c"] == "container-123"
    assert kwargs["ExpressionAttributeValues"][":cnt"] == 2
    assert "statusKey" not in kwargs["UpdateExpression"]


def test_processing_target_parent_has_no_status_key_after_rollup():
    """Test matrix #5, end to end: rolling up a parent with a processing
    target must REMOVE statusKey (via the existing non-pending branch of
    updateParentStatus), not set it -- otherwise the sparse byStatusTime
    index would make the maintenance sweep republish a post whose media is
    still mid-processing."""
    from social import storage

    table = MagicMock()
    table.query.return_value = {
        "Items": [
            {"PK": "POST#post1", "SK": "META", "postId": "post1"},
            {"PK": "POST#post1", "SK": "TARGET#instagram#a", "status": storage.STATUS_PROCESSING},
        ]
    }

    with patch.object(storage, "_tbl", return_value=table):
        result = storage.rollupParentStatus("post1")

    assert result == storage.STATUS_PUBLISHING
    update_kwargs = table.update_item.call_args.kwargs
    assert "REMOVE statusKey" in update_kwargs["UpdateExpression"]
    assert ":sk" not in update_kwargs["ExpressionAttributeValues"]


# --- findStuckProcessingTargets / findExpiredContainerTargets (phase 5) -----------


def test_find_stuck_processing_targets_filters_status_and_updated_at():
    from social import storage

    table = MagicMock()
    table.scan.return_value = {"Items": []}

    with patch.object(storage, "_tbl", return_value=table):
        storage.findStuckProcessingTargets(30)

    kwargs = table.scan.call_args.kwargs
    leaves = _flattenConditionExpression(kwargs["FilterExpression"])
    leafByAttr = {name: (op, val) for name, op, val in leaves}
    assert leafByAttr["status"] == ("=", storage.STATUS_PROCESSING)
    assert leafByAttr["entityType"] == ("=", "socialTarget")
    assert leafByAttr["updatedAt"][0] == "<"


def test_find_expired_container_targets_filters_status_and_container_created_at():
    from social import storage

    table = MagicMock()
    table.scan.return_value = {"Items": []}

    with patch.object(storage, "_tbl", return_value=table):
        storage.findExpiredContainerTargets(24)

    kwargs = table.scan.call_args.kwargs
    leaves = _flattenConditionExpression(kwargs["FilterExpression"])
    leafByAttr = {name: (op, val) for name, op, val in leaves}
    assert leafByAttr["status"] == ("=", storage.STATUS_PROCESSING)
    assert leafByAttr["containerCreatedAt"][0] == "<"


def test_find_stuck_processing_targets_paginates():
    from social import storage

    table = MagicMock()
    table.scan.side_effect = [
        {"Items": [{"postId": "p1"}], "LastEvaluatedKey": {"PK": "x"}},
        {"Items": [{"postId": "p2"}]},
    ]

    with patch.object(storage, "_tbl", return_value=table):
        result = storage.findStuckProcessingTargets(30)

    assert [i["postId"] for i in result] == ["p1", "p2"]
    assert table.scan.call_count == 2
    assert table.scan.call_args_list[1].kwargs["ExclusiveStartKey"] == {"PK": "x"}
