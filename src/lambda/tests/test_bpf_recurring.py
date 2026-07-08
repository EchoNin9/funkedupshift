"""Unit tests for recurring charge detection (FUNK-31)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf_recurring


def _txn(date, amount, payee, category="Subscriptions", **extra):
    return {"date": date, "amount": amount, "payee": payee, "category": category, **extra}


def test_monthly_subscription_detected():
    txns = [_txn(f"2026-0{m}-15", -15.99, "NETFLIX.COM") for m in range(1, 7)]
    out = bpf_recurring.detect_recurring(txns)
    assert len(out) == 1
    r = out[0]
    assert r["cadence"] == "monthly"
    assert r["typicalAmount"] == 15.99
    assert r["occurrences"] == 6
    assert r["lastDate"] == "2026-06-15"
    # gaps [31, 28, 31, 30, 31] -> median 31 -> 2026-06-15 + 31d
    assert r["nextExpected"] == "2026-07-16"


def test_weekly_detected():
    dates = ["2026-05-01", "2026-05-08", "2026-05-15", "2026-05-22", "2026-05-29"]
    out = bpf_recurring.detect_recurring([_txn(d, -12.0, "F45 Training") for d in dates])
    assert len(out) == 1
    assert out[0]["cadence"] == "weekly"
    assert out[0]["nextExpected"] == "2026-06-05"


def test_annual_detected():
    dates = ["2024-03-01", "2025-03-01", "2026-03-01"]
    out = bpf_recurring.detect_recurring([_txn(d, -139.0, "AMAZON PRIME") for d in dates])
    assert len(out) == 1
    assert out[0]["cadence"] == "annual"
    assert out[0]["nextExpected"] == "2027-03-01"


def test_irregular_gaps_excluded():
    dates = ["2026-01-01", "2026-01-13", "2026-03-24"]  # gaps 12, 70 -> median 41
    out = bpf_recurring.detect_recurring([_txn(d, -20.0, "Random Shop") for d in dates])
    assert out == []


def test_two_occurrences_excluded():
    txns = [_txn("2026-01-15", -9.99, "Hulu"), _txn("2026-02-15", -9.99, "Hulu")]
    assert bpf_recurring.detect_recurring(txns) == []


def test_transfer_rows_ignored():
    txns = [_txn(f"2026-0{m}-01", -500.0, "Savings sweep", transferId="tr-1")
            for m in range(1, 7)]
    txns += [_txn(f"2026-0{m}-02", -500.0, "To Brokerage", category="Transfer")
             for m in range(1, 7)]
    assert bpf_recurring.detect_recurring(txns) == []


def test_amount_wobble_within_20pct_detected():
    amounts = [-100.0, -115.0, -85.0, -100.0, -115.0, -85.0]  # +/-15%
    txns = [_txn(f"2026-0{m}-15", a, "City Hydro", category="Utilities")
            for m, a in enumerate(amounts, start=1)]
    out = bpf_recurring.detect_recurring(txns)
    assert len(out) == 1
    assert out[0]["typicalAmount"] == 100.0


def test_amount_wobble_60pct_excluded():
    amounts = [-100.0, -160.0, -40.0, -100.0, -160.0, -40.0]  # +/-60%
    txns = [_txn(f"2026-0{m}-15", a, "Chaotic Vendor")
            for m, a in enumerate(amounts, start=1)]
    assert bpf_recurring.detect_recurring(txns) == []


def test_payee_normalization_groups_store_numbers():
    txns = [
        _txn("2026-01-10", -11.99, "SPOTIFY 123"),
        _txn("2026-02-10", -11.99, "SPOTIFY 456"),
        _txn("2026-03-10", -11.99, "SPOTIFY 789"),
    ]
    out = bpf_recurring.detect_recurring(txns)
    assert len(out) == 1
    assert out[0]["occurrences"] == 3
    assert out[0]["cadence"] == "monthly"
    assert out[0]["payee"] == "SPOTIFY 789"  # most recent original text


def test_income_rows_ignored():
    txns = [_txn(f"2026-0{m}-01", 2500.0, "EMPLOYER PAYROLL", category="Income")
            for m in range(1, 7)]
    assert bpf_recurring.detect_recurring(txns) == []


def test_same_day_duplicates_collapse_and_sorting():
    netflix = [_txn(f"2026-0{m}-15", -15.99, "NETFLIX.COM") for m in range(1, 7)]
    netflix.append(_txn("2026-02-15", -15.99, "NETFLIX.COM"))  # same-day duplicate
    gym = [_txn(f"2026-0{m}-01", -45.0, "GoodLife Fitness") for m in range(1, 7)]
    out = bpf_recurring.detect_recurring(netflix + gym)
    assert [r["typicalAmount"] for r in out] == [45.0, 15.99]  # descending
    assert out[1]["occurrences"] == 6  # duplicate date counted once
