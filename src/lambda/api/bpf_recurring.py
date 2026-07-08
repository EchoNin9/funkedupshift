"""
Recurring charge detection (FUNK-31): pure-stdlib heuristics over already
loaded transaction dicts. No storage or network access — callers pass rows
from any source (local B&PF transactions, Era exports) shaped like
{"date": "YYYY-MM-DD", "amount": float, "payee": str, "category": str}.
"""
import re
import statistics
from datetime import datetime, timedelta

MIN_OCCURRENCES = 3
AMOUNT_TOLERANCE = 0.20  # quartiles must sit within ±20% of the median amount

# (cadence, min median gap, max median gap) in days, inclusive.
CADENCES = (("weekly", 5, 9), ("monthly", 26, 35), ("annual", 350, 380))

_STORE_NUMBERS = re.compile(r"#?\d+")
_WHITESPACE = re.compile(r"\s+")


def _normalize_payee(payee):
    """Grouping key: lowercase, digit runs / '#'-store numbers stripped,
    whitespace collapsed — 'NETFLIX.COM 8844' groups with 'NETFLIX.COM'."""
    s = _STORE_NUMBERS.sub(" ", str(payee).lower())
    return _WHITESPACE.sub(" ", s).strip()


def _cadence(median_gap):
    for name, lo, hi in CADENCES:
        if lo <= median_gap <= hi:
            return name
    return None


def detect_recurring(txns):
    """Detect recurring charges in a list of transaction dicts.

    Considers spend rows only (amount < 0), skipping transfers (truthy
    transferId or category 'Transfer'). Rows are grouped by normalized payee;
    a group is recurring when it has >= 3 distinct dates, the median day-gap
    matches a cadence, and the amount quartiles stay within ±20% of the
    median absolute amount.

    Returns a list sorted by typicalAmount descending:
    {"payee", "cadence", "typicalAmount", "occurrences", "lastDate",
     "nextExpected"} — payee is the most recent row's original text,
    typicalAmount the median absolute amount, nextExpected lastDate plus
    the median gap.
    """
    groups = {}
    for t in txns:
        if t.get("amount", 0) >= 0:
            continue
        if t.get("transferId") or t.get("category") == "Transfer":
            continue
        key = _normalize_payee(t.get("payee") or "")
        if not key:
            continue
        groups.setdefault(key, []).append(t)

    out = []
    for rows in groups.values():
        rows.sort(key=lambda t: t["date"])
        # Same-day duplicates collapse to one occurrence per date so a double
        # charge doesn't inject zero-day gaps.
        by_date = {t["date"]: t for t in rows}
        if len(by_date) < MIN_OCCURRENCES:
            continue
        occurrences = [by_date[d] for d in sorted(by_date)]
        dates = [datetime.strptime(t["date"], "%Y-%m-%d").date() for t in occurrences]
        gap = statistics.median((b - a).days for a, b in zip(dates, dates[1:]))
        cadence = _cadence(gap)
        if not cadence:
            continue
        amounts = sorted(-t["amount"] for t in occurrences)
        typical = statistics.median(amounts)
        q1, _, q3 = statistics.quantiles(amounts, n=4, method="inclusive")
        if q1 < typical * (1 - AMOUNT_TOLERANCE) or q3 > typical * (1 + AMOUNT_TOLERANCE):
            continue
        out.append({
            "payee": occurrences[-1]["payee"],
            "cadence": cadence,
            "typicalAmount": round(typical, 2),
            "occurrences": len(occurrences),
            "lastDate": dates[-1].isoformat(),
            "nextExpected": (dates[-1] + timedelta(days=round(gap))).isoformat(),
        })
    out.sort(key=lambda r: r["typicalAmount"], reverse=True)
    return out
