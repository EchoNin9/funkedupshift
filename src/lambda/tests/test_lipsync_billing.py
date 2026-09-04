"""Unit tests for lipsync/billing.py -- the fal.ai account balance reader.

The endpoint is verified real (401 unauthenticated); its RESPONSE SHAPE is
not, because confirming that needs an authenticated call against a funded
account. So the parser is written to walk candidate paths and give up rather
than guess, and these tests pin exactly that: a wrong balance is worse than a
missing one, because it feeds both the admin's over-commitment view and the
low-balance killswitch.
"""
import json
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lipsync import billing  # noqa: E402


def _mockResponse(payload):
    resp = MagicMock()
    resp.read.return_value = json.dumps(payload).encode("utf-8")
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def _table(item=None):
    table = MagicMock()
    table.get_item.return_value = {"Item": item} if item else {}
    return table


# --- shape tolerance -------------------------------------------------------------


def test_recognised_shapes_parse_to_cents():
    assert billing.extractBalanceCents({"credits": {"balance": 42.13}}) == 4213
    assert billing.extractBalanceCents({"balance": 10}) == 1000
    assert billing.extractBalanceCents({"account": {"credits": {"balance": 1}}}) == 100


def test_unrecognised_shape_returns_none_rather_than_guessing():
    """The whole point of the defensive parser: an unknown shape must produce
    'unavailable', never a fabricated number."""
    assert billing.extractBalanceCents({"totally": {"different": 5}}) is None
    assert billing.extractBalanceCents({}) is None
    assert billing.extractBalanceCents([1, 2, 3]) is None
    assert billing.extractBalanceCents(None) is None


def test_non_numeric_values_are_not_coerced():
    """A string or bool at a candidate path is NOT money. Coercing it would
    turn a shape change at fal into a silently wrong balance."""
    assert billing.extractBalanceCents({"balance": "42.13"}) is None
    assert billing.extractBalanceCents({"balance": True}) is None
    assert billing.extractBalanceCents({"balance": {"nested": 1}}) is None


# --- fetch + failure modes -------------------------------------------------------


def test_successful_fetch_caches_the_value():
    table = _table()
    with patch.object(billing, "_tbl", return_value=table), \
            patch.object(billing, "getFalApiKey", return_value="k"), \
            patch.object(billing, "urlopen", return_value=_mockResponse({"credits": {"balance": 12.5}})):
        result = billing.getBalance()
    assert result.cents == 1250
    assert result.available is True
    assert isinstance(table.put_item.call_args.kwargs["Item"]["balanceCents"], Decimal)


def test_fresh_cache_avoids_a_second_http_call():
    import time
    cached = {"balanceCents": Decimal(999), "fetchedAt": "x", "fetchedAtEpoch": Decimal(int(time.time()))}
    with patch.object(billing, "_tbl", return_value=_table(cached)), \
            patch.object(billing, "urlopen") as mockOpen:
        result = billing.getBalance()
    assert result.cents == 999
    mockOpen.assert_not_called()


def test_force_bypasses_the_cache():
    import time
    cached = {"balanceCents": Decimal(999), "fetchedAt": "x", "fetchedAtEpoch": Decimal(int(time.time()))}
    with patch.object(billing, "_tbl", return_value=_table(cached)), \
            patch.object(billing, "getFalApiKey", return_value="k"), \
            patch.object(billing, "urlopen", return_value=_mockResponse({"balance": 1})) as mockOpen:
        result = billing.getBalance(force=True)
    mockOpen.assert_called_once()
    assert result.cents == 100


def test_http_error_with_a_cached_value_returns_it_marked_stale():
    """An admin is better served by a labelled old number than a blank."""
    cached = {"balanceCents": Decimal(555), "fetchedAt": "earlier", "fetchedAtEpoch": Decimal(0)}
    with patch.object(billing, "_tbl", return_value=_table(cached)), \
            patch.object(billing, "getFalApiKey", return_value="k"), \
            patch.object(billing, "urlopen", side_effect=HTTPError("u", 500, "err", None, None)):
        result = billing.getBalance()
    assert result.cents == 555
    assert result.stale is True
    assert result.available is True


def test_unreachable_fal_with_no_cache_is_unavailable_not_zero():
    """`cents is None` is the contract for 'unavailable'. Returning 0 here
    would read as an empty account and trip the killswitch on an outage."""
    with patch.object(billing, "_tbl", return_value=_table()), \
            patch.object(billing, "getFalApiKey", return_value="k"), \
            patch.object(billing, "urlopen", side_effect=URLError("nope")):
        result = billing.getBalance()
    assert result.cents is None
    assert result.available is False
    assert result.toDict()["falBalanceCents"] is None


def test_successful_call_with_unknown_shape_is_unavailable():
    with patch.object(billing, "_tbl", return_value=_table()), \
            patch.object(billing, "getFalApiKey", return_value="k"), \
            patch.object(billing, "urlopen", return_value=_mockResponse({"surprise": 1})):
        result = billing.getBalance()
    assert result.cents is None
    assert "not recognised" in result.reason


def test_missing_api_key_degrades_instead_of_raising():
    with patch.object(billing, "_tbl", return_value=_table()), \
            patch.object(billing, "getFalApiKey", side_effect=RuntimeError("no param")):
        result = billing.getBalance()
    assert result.cents is None
