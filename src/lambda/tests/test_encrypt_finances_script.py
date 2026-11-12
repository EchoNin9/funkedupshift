"""FUNK-78 migration script (scripts/encrypt_finances.py) against an in-memory table."""
import importlib.util
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf, bpf_crypto  # noqa: E402
from tests.fake_ddb import FakeTable  # noqa: E402

_SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "encrypt_finances.py"
_spec = importlib.util.spec_from_file_location("encrypt_finances", _SCRIPT)
script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(script)

PK = {"S": "USER#u1"}


def _legacy_table():
    t = FakeTable()
    t.put({"PK": PK, "SK": {"S": "BPF#TXN#2026-07-01#t1"}, "accountId": {"S": "a1"},
           "amount": {"N": "-45.2"}, "payee": {"S": "Zebra"}, "category": {"S": "Dining"},
           "notes": {"S": ""}, "business": {"BOOL": False}, "updatedAt": {"S": "T1"},
           "fitid": {"S": "f1"}, "transferId": {"S": "xfer1"}})
    t.put({"PK": PK, "SK": {"S": "BPF#ACCOUNT#a1"}, "name": {"S": "Chequing"},
           "kind": {"S": "checking"}, "openingBalance": {"N": "100"}, "currency": {"S": "USD"},
           "accountNumber": {"S": "12345678"}, "updatedAt": {"S": "T2"}})
    t.put({"PK": PK, "SK": {"S": "BPF#ACCOUNT#old"}, "name": {"S": "Legacy"},
           "kind": {"S": "cash"}, "balance": {"N": "5"}})  # no updatedAt
    t.put({"PK": PK, "SK": {"S": "BPF#SETTINGS"}, "categories": {"L": [{"S": "Dining"}]},
           "updatedAt": {"S": "T3"}})
    t.put({"PK": PK, "SK": {"S": "BPF#BUDGETS"}, "budgets": {"L": [
        {"M": {"category": {"S": "Dining"}, "monthlyLimit": {"N": "50"}}}]},
        "updatedAt": {"S": "T4"}})
    t.put({"PK": PK, "SK": {"S": "BPF#RULES"}, "rules": {"L": [
        {"M": {"match": {"S": "contains"}, "pattern": {"S": "zeb"},
               "category": {"S": "Dining"}, "source": {"S": "manual"}}}]},
        "updatedAt": {"S": "T5"}})
    # must be left alone
    t.put({"PK": PK, "SK": {"S": "BPF#SHARE#g1"}, "granteeEmail": {"S": "g@x.com"},
           "sections": {"L": [{"S": "dashboard"}]}})
    t.put({"PK": {"S": "USER#g1"}, "SK": {"S": "BPF#SHAREDWITH#u1"},
           "ownerEmail": {"S": "o@x.com"}})
    t.put({"PK": PK, "SK": {"S": "BPF#DEK"}, "wrappedKey": {"B": b"x"}})
    return t


def test_dry_run_counts_and_writes_nothing():
    t = _legacy_table()
    stats = script.encrypt_items(t, "tbl", apply=False)
    assert stats["needs_work"] == 6 and stats["updated"] == 0
    assert t.writes == []


def test_apply_encrypts_and_reads_back_and_is_idempotent():
    t = _legacy_table()
    stats = script.encrypt_items(t, "tbl", apply=True)
    assert stats["updated"] == 6 and stats["skipped_conflict"] == 0
    blob = repr(t.writes)
    for plain in ("Zebra", "Dining", "12345678", "Chequing", "-45.2", "zeb", "Legacy"):
        assert plain not in blob
    # the unencrypted columns and untouched items survive; updatedAt is not bumped
    raw = t.items[("USER#u1", "BPF#TXN#2026-07-01#t1")]
    assert raw["transferId"] == {"S": "xfer1"} and raw["updatedAt"] == {"S": "T1"}
    assert t.items[("USER#u1", "BPF#SHARE#g1")]["granteeEmail"] == {"S": "g@x.com"}
    # the app's readers see the original values
    assert t.items  # noqa
    txn = bpf._txn_from_item(raw)
    assert (txn["amount"], txn["payee"], txn["category"], txn["fitid"]) == (-45.2, "Zebra", "Dining", "f1")
    acct = bpf._account_from_item(t.items[("USER#u1", "BPF#ACCOUNT#a1")])
    assert acct["name"] == "Chequing" and acct["openingBalance"] == 100.0
    assert bpf._account_from_item(t.items[("USER#u1", "BPF#ACCOUNT#old")])["openingBalance"] == 5.0
    assert bpf_crypto.dec_json("u1", "USER#u1", "BPF#BUDGETS", "budgets",
                               t.items[("USER#u1", "BPF#BUDGETS")]["budgets"]) == [
        {"category": "Dining", "monthlyLimit": "50"}]
    # no float types written
    assert "float" not in repr([type(v).__name__ for _, w in t.writes
                                for v in w.get("Values", {}).values()])
    # second run changes nothing
    t.writes.clear()
    again = script.encrypt_items(t, "tbl", apply=True)
    assert again["needs_work"] == 0 and again["updated"] == 0 and t.writes == []


def test_update_is_conditional_on_updated_at():
    t = _legacy_table()
    orig = t.update_item
    calls = []

    def spy(**kw):
        calls.append(kw["ConditionExpression"])
        return orig(**kw)

    t.update_item = spy
    script.encrypt_items(t, "tbl", apply=True)
    assert "updatedAt = :cur" in calls and "attribute_not_exists(updatedAt)" in calls


def test_concurrent_edit_is_skipped_not_clobbered():
    t = _legacy_table()
    real_scan = t.scan

    def scan_then_edit(**kw):
        resp = real_scan(**kw)
        # a user edit lands after the scan read the item
        t.items[("USER#u1", "BPF#TXN#2026-07-01#t1")]["updatedAt"] = {"S": "T9"}
        t.items[("USER#u1", "BPF#TXN#2026-07-01#t1")]["payee"] = {"S": "Edited"}
        return resp

    t.scan = scan_then_edit
    stats = script.encrypt_items(t, "tbl", apply=True)
    assert stats["skipped_conflict"] == 1 and stats["updated"] == 5
    assert t.items[("USER#u1", "BPF#TXN#2026-07-01#t1")]["payee"] == {"S": "Edited"}
    t.scan = real_scan
    assert script.encrypt_items(t, "tbl", apply=True)["updated"] == 1  # re-run picks it up


def test_verify_counts_and_exit_code(monkeypatch):
    t = _legacy_table()
    before = script.verify(t, "tbl")
    assert before["transaction"] == 5 and before["account"] == 5  # incl. legacy `balance`
    assert before["settings"] == before["budgets"] == before["rules"] == 1
    script.encrypt_items(t, "tbl", apply=True)
    assert set(script.verify(t, "tbl").values()) == {0}

    import types
    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=lambda *_: t))
    assert script.main(["--table", "tbl", "--key-id", "arn:x", "--verify"]) == 0
    t.put({"PK": PK, "SK": {"S": "BPF#TXN#2026-07-02#t2"}, "amount": {"N": "1"}})
    assert script.main(["--table", "tbl", "--key-id", "arn:x", "--verify"]) == 1
