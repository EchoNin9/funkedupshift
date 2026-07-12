"""Unit tests for payee -> category rules (FUNK-30, api/bpf_rules.py)."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf_rules
from api.bpf_rules import apply_rules, get_rules, save_rules


# --- apply_rules (pure) -------------------------------------------------------

def test_apply_rules_contains():
    rules = [{"match": "contains", "pattern": "coffee", "category": "Dining", "source": "manual"}]
    assert apply_rules(rules, "Blue Bottle Coffee #42") == "Dining"
    assert apply_rules(rules, "Grocery Store") is None


def test_apply_rules_starts_with():
    rules = [{"match": "starts_with", "pattern": "uber", "category": "Transportation", "source": "manual"}]
    assert apply_rules(rules, "UBER *TRIP 123") == "Transportation"
    assert apply_rules(rules, "Not Uber") is None


def test_apply_rules_equals():
    rules = [{"match": "equals", "pattern": "netflix", "category": "Subscriptions", "source": "manual"}]
    assert apply_rules(rules, "Netflix") == "Subscriptions"
    assert apply_rules(rules, "Netflix.com") is None


def test_apply_rules_case_insensitive():
    rules = [{"match": "contains", "pattern": "SAFEWAY", "category": "Groceries", "source": "manual"}]
    assert apply_rules(rules, "safeway #1223") == "Groceries"


def test_apply_rules_first_match_wins():
    rules = [
        {"match": "contains", "pattern": "amazon prime", "category": "Subscriptions", "source": "manual"},
        {"match": "contains", "pattern": "amazon", "category": "Shopping", "source": "manual"},
    ]
    assert apply_rules(rules, "Amazon Prime Video") == "Subscriptions"
    assert apply_rules(rules, "Amazon Marketplace") == "Shopping"
    # Order is priority: a broader rule first shadows the narrower one.
    assert apply_rules(list(reversed(rules)), "Amazon Prime Video") == "Shopping"


def test_apply_rules_no_match_and_empty():
    rules = [{"match": "contains", "pattern": "coffee", "category": "Dining", "source": "manual"}]
    assert apply_rules(rules, "Hardware Store") is None
    assert apply_rules([], "Anything") is None


# --- save_rules ---------------------------------------------------------------

def test_save_rules_rejects_non_list():
    with patch.object(bpf_rules, "_ddb") as mock_ddb:
        clean, err = save_rules("u1", "nope")
    assert clean is None and err
    mock_ddb.assert_not_called()


def test_save_rules_rejects_bad_match_mode():
    with patch.object(bpf_rules, "_ddb") as mock_ddb:
        clean, err = save_rules("u1", [{"match": "regex", "pattern": "x", "category": "Other"}])
    assert clean is None and "match" in err
    mock_ddb.assert_not_called()


def test_save_rules_rejects_empty_pattern():
    with patch.object(bpf_rules, "_ddb") as mock_ddb:
        clean, err = save_rules("u1", [{"match": "contains", "pattern": "   ", "category": "Other"}])
    assert clean is None and "pattern" in err
    mock_ddb.assert_not_called()


def test_save_rules_rejects_empty_category():
    with patch.object(bpf_rules, "_ddb") as mock_ddb:
        clean, err = save_rules("u1", [{"match": "contains", "pattern": "x", "category": ""}])
    assert clean is None and "category" in err
    mock_ddb.assert_not_called()


def test_save_rules_rejects_non_dict_rule():
    with patch.object(bpf_rules, "_ddb") as mock_ddb:
        clean, err = save_rules("u1", ["not a dict"])
    assert clean is None and err
    mock_ddb.assert_not_called()


def test_save_rules_happy_path_writes_typed_item():
    ddb = MagicMock()
    with patch.object(bpf_rules, "_ddb", return_value=ddb):
        clean, err = save_rules("u1", [
            {"match": "contains", "pattern": "  Coffee ", "category": " Dining "},
            {"match": "equals", "pattern": "netflix", "category": "Subscriptions", "source": "ai"},
        ])
    assert err is None
    assert clean == [
        {"match": "contains", "pattern": "Coffee", "category": "Dining", "source": "manual"},
        {"match": "equals", "pattern": "netflix", "category": "Subscriptions", "source": "ai"},
    ]
    ddb.put_item.assert_called_once()
    item = ddb.put_item.call_args.kwargs["Item"]
    assert item["PK"] == {"S": "USER#u1"}
    assert item["SK"] == {"S": "BPF#RULES"}
    assert item["rules"] == {"L": [
        {"M": {"match": {"S": "contains"}, "pattern": {"S": "Coffee"},
               "category": {"S": "Dining"}, "source": {"S": "manual"}}},
        {"M": {"match": {"S": "equals"}, "pattern": {"S": "netflix"},
               "category": {"S": "Subscriptions"}, "source": {"S": "ai"}}},
    ]}
    assert item["updatedAt"]["S"].endswith("Z")


def test_save_rules_preserves_order():
    ddb = MagicMock()
    rules = [
        {"match": "contains", "pattern": "b", "category": "B"},
        {"match": "contains", "pattern": "a", "category": "A"},
    ]
    with patch.object(bpf_rules, "_ddb", return_value=ddb):
        clean, err = save_rules("u1", rules)
    assert err is None
    assert [r["pattern"] for r in clean] == ["b", "a"]


# --- get_rules ------------------------------------------------------------------

def test_get_rules_parses_typed_item_and_defaults_source():
    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": {
        "rules": {"L": [
            {"M": {"match": {"S": "contains"}, "pattern": {"S": "coffee"},
                   "category": {"S": "Dining"}}},  # no source attr
            {"M": {"match": {"S": "equals"}, "pattern": {"S": "netflix"},
                   "category": {"S": "Subscriptions"}, "source": {"S": "ai"}}},
        ]},
    }}
    with patch.object(bpf_rules, "_ddb", return_value=ddb):
        rules = get_rules("u1")
    assert rules == [
        {"match": "contains", "pattern": "coffee", "category": "Dining", "source": "manual"},
        {"match": "equals", "pattern": "netflix", "category": "Subscriptions", "source": "ai"},
    ]
    ddb.get_item.assert_called_once_with(
        TableName=bpf_rules.TABLE_NAME,
        Key={"PK": {"S": "USER#u1"}, "SK": {"S": "BPF#RULES"}},
    )


def test_get_rules_empty_when_no_item():
    ddb = MagicMock()
    ddb.get_item.return_value = {}
    with patch.object(bpf_rules, "_ddb", return_value=ddb):
        assert get_rules("u1") == []
