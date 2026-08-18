"""Unit tests for lipsync/budget.py -- the per-user spend ledger.

This is the code standing between an open module and an unbounded fal bill, so
the tests care as much about the FAILURE paths (insufficient funds, no record,
replayed settlement) as the happy one.

The DynamoDB table is a MagicMock, matching this repo's convention. That has a
known blind spot -- a mock never exercises boto3's serializer, which is exactly
how a raw-float bug shipped in this module before (CLAUDE.md gotcha #3) -- so
the money tests assert the TYPE written, not just the value.
"""
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lipsync import budget  # noqa: E402


def _conditionalFailure():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


def _table(item=None):
    table = MagicMock()
    table.get_item.return_value = {"Item": item} if item else {}
    return table


def _record(budgetCents=1500, spentCents=0, reservedCents=0, availableCents=None):
    return {
        "PK": "USER#a@example.com", "SK": "BUDGET", "username": "a@example.com",
        "budgetCents": Decimal(budgetCents), "spentCents": Decimal(spentCents),
        "reservedCents": Decimal(reservedCents),
        "availableCents": Decimal(budgetCents - spentCents - reservedCents
                                  if availableCents is None else availableCents),
        "updatedAt": "", "updatedBy": "", "note": "",
    }


# --- getBudget -------------------------------------------------------------------


def test_missing_record_reads_as_zero_and_flags_not_existing():
    """A user with no allocation is $0, and `exists` distinguishes that from
    'allocated and fully spent' -- the UI words those differently."""
    with patch.object(budget, "_tbl", return_value=_table()):
        result = budget.getBudget("nobody@example.com")
    assert result["budgetCents"] == 0
    assert result["remainingCents"] == 0
    assert result["exists"] is False


def test_remaining_never_goes_negative():
    """An admin can lower a budget below what is already committed; the
    contract still promises a non-negative remaining."""
    with patch.object(budget, "_tbl", return_value=_table(_record(budgetCents=100, spentCents=900))):
        result = budget.getBudget("a@example.com")
    assert result["remainingCents"] == 0


# --- reserve ---------------------------------------------------------------------


def test_reserve_succeeds_and_moves_available_into_reserved():
    table = _table()
    with patch.object(budget, "_tbl", return_value=table):
        assert budget.reserve("a@example.com", 173) is True
    kwargs = table.update_item.call_args.kwargs
    assert "availableCents >= :amount" in kwargs["ConditionExpression"]
    assert "attribute_exists(availableCents)" in kwargs["ConditionExpression"]
    assert kwargs["ExpressionAttributeValues"][":amount"] == Decimal(173)


def test_reserve_fails_closed_on_conditional_check():
    """The conditional write IS the concurrency control: two jobs racing for
    the same last dollar means the loser gets False and must not call fal."""
    table = _table()
    table.update_item.side_effect = _conditionalFailure()
    with patch.object(budget, "_tbl", return_value=table):
        assert budget.reserve("a@example.com", 500) is False


def test_reserve_on_a_missing_record_fails_without_creating_one():
    """$0 default: a brand-new account must never be able to spend, and a
    failed reserve must not conjure a funded record."""
    table = _table()
    table.update_item.side_effect = _conditionalFailure()
    with patch.object(budget, "_tbl", return_value=table):
        assert budget.reserve("nobody@example.com", 1) is False
    table.put_item.assert_not_called()


def test_reserve_reraises_non_conditional_errors():
    """A throttle or an outage must not be silently read as 'insufficient
    funds' -- that would make a DynamoDB blip look like a budget problem."""
    table = _table()
    table.update_item.side_effect = ClientError(
        {"Error": {"Code": "ProvisionedThroughputExceededException"}}, "UpdateItem")
    with patch.object(budget, "_tbl", return_value=table):
        with pytest.raises(ClientError):
            budget.reserve("a@example.com", 10)


# --- settle / release ------------------------------------------------------------


def test_settle_charges_actual_and_refunds_the_unused_hold():
    """The hold is an estimate; the settle uses the MEASURED duration. The
    difference goes back to the user."""
    table = _table()
    with patch.object(budget, "_tbl", return_value=table):
        budget.settle("a@example.com", reservedCents=200, actualCents=173)
    values = table.update_item.call_args.kwargs["ExpressionAttributeValues"]
    assert values[":hold"] == Decimal(200)
    assert values[":cost"] == Decimal(173)
    assert values[":refund"] == Decimal(27)


def test_settle_can_overshoot_the_hold():
    """A clip longer than estimated costs more than was held. Available goes
    negative, which is correct -- the work ran and fal billed for it; reserve()
    then refuses further jobs until a top-up."""
    table = _table()
    with patch.object(budget, "_tbl", return_value=table):
        budget.settle("a@example.com", reservedCents=100, actualCents=173)
    assert table.update_item.call_args.kwargs["ExpressionAttributeValues"][":refund"] == Decimal(-73)


def test_release_returns_the_hold_and_charges_nothing():
    table = _table()
    with patch.object(budget, "_tbl", return_value=table):
        budget.release("a@example.com", 173)
    expr = table.update_item.call_args.kwargs["UpdateExpression"]
    assert "reservedCents = reservedCents - :amount" in expr
    assert "availableCents = availableCents + :amount" in expr
    assert "spentCents" not in expr, "a released hold must never become spend"


# --- money discipline ------------------------------------------------------------


def test_every_written_money_value_is_decimal_never_float():
    """boto3's Table resource raises TypeError on a raw Python float, but a
    MagicMock table swallows it -- this module already shipped that exact bug
    once. Assert the TYPE, because `Decimal(12) == 12.0` is True and a value
    assertion alone would pass on a float.
    """
    table = _table()
    with patch.object(budget, "_tbl", return_value=table):
        budget.setBudget("a@example.com", 1500, updatedBy="admin@example.com")
    item = table.put_item.call_args.kwargs["Item"]
    for field in ("budgetCents", "spentCents", "reservedCents", "availableCents"):
        assert isinstance(item[field], Decimal), f"{field} must be Decimal, got {type(item[field])}"
        assert not isinstance(item[field], float)


def test_non_integral_and_negative_cents_are_rejected():
    """Money is whole cents. Silently truncating a fractional charge is how
    ledgers drift."""
    with pytest.raises(ValueError):
        budget._cents(12.5)
    with pytest.raises(ValueError):
        budget._cents(-1)


def test_set_budget_preserves_committed_spend_and_clamps_available():
    table = _table(_record(budgetCents=5000, spentCents=1000, reservedCents=500))
    with patch.object(budget, "_tbl", return_value=table):
        budget.setBudget("a@example.com", 1200, updatedBy="admin@example.com")
    item = table.put_item.call_args.kwargs["Item"]
    assert item["spentCents"] == Decimal(1000), "lowering a budget must not erase spend"
    assert item["reservedCents"] == Decimal(500), "nor cancel in-flight holds"
    # 1200 - 1000 spent - 500 held is -300; available clamps at 0. The
    # already-held work still settles, the budget just can't be added to.
    assert item["availableCents"] == Decimal(0)

    table2 = _table(_record(budgetCents=5000, spentCents=4900, reservedCents=0))
    with patch.object(budget, "_tbl", return_value=table2):
        budget.setBudget("a@example.com", 100, updatedBy="admin@example.com")
    assert table2.put_item.call_args.kwargs["Item"]["availableCents"] == Decimal(0)


# --- finalizeJobHold: the one-time guarantee -------------------------------------


def _heldJob(jobId="job1", reservedCents=173, identity="a@example.com"):
    return {"jobId": jobId, "reservedCents": Decimal(reservedCents), "budgetIdentity": identity}


def test_finalize_settles_once_and_is_a_no_op_when_replayed():
    """The runner can be replayed (EventBridge is at-least-once) and a cancel
    can race it. Whoever flips budgetSettled first does the ledger write."""
    table = _table()
    with patch.object(budget, "_tbl", return_value=table), \
            patch.object(budget, "settle") as mockSettle:
        assert budget.finalizeJobHold(_heldJob(), actualCents=150) is True
        mockSettle.assert_called_once_with("a@example.com", 173, 150)

    table2 = _table()
    table2.update_item.side_effect = _conditionalFailure()
    with patch.object(budget, "_tbl", return_value=table2), \
            patch.object(budget, "settle") as mockSettle2:
        assert budget.finalizeJobHold(_heldJob(), actualCents=150) is False
        mockSettle2.assert_not_called()


def test_finalize_with_no_actual_cost_releases_instead_of_charging():
    table = _table()
    with patch.object(budget, "_tbl", return_value=table), \
            patch.object(budget, "release") as mockRelease, \
            patch.object(budget, "settle") as mockSettle:
        budget.finalizeJobHold(_heldJob(), actualCents=None)
    mockRelease.assert_called_once_with("a@example.com", 173)
    mockSettle.assert_not_called()


def test_finalize_ignores_a_job_with_no_recorded_budget_identity():
    """Jobs created before budgets existed carry no identity; they must be
    skipped rather than charged to an empty-string user."""
    table = _table()
    with patch.object(budget, "_tbl", return_value=table), \
            patch.object(budget, "release") as mockRelease:
        assert budget.finalizeJobHold(_heldJob(identity=""), actualCents=None) is False
    mockRelease.assert_not_called()
