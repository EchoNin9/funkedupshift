"""FUNK-78: request logging must not leak credentials or finance data."""
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import handler  # noqa: E402


def _event(path, body=None, qs=None):
    return {
        "rawPath": path,
        "rawQueryString": qs or "",
        "queryStringParameters": dict(p.split("=") for p in qs.split("&")) if qs else None,
        "requestContext": {"http": {"method": "POST", "path": path}},
        "headers": {"Authorization": "Bearer eyJsecret", "Cookie": "s=1", "content-type": "application/json"},
        "body": body,
    }


def test_finance_body_and_query_redacted():
    body = json.dumps({"accountNumber": "1234567890", "payee": "SECRET PAYEE", "amount": -42.5})
    out = json.dumps(handler._redactEventForLog(_event("/finances/accounts", body, "q=SECRETQ&owner=abc")))
    for secret in ("1234567890", "SECRET PAYEE", "-42.5", "SECRETQ", "eyJsecret", "s=1"):
        assert secret not in out
    assert f"<{len(body)} chars redacted>" in out
    assert "content-type" in out  # non-secret headers kept


def test_non_finance_keeps_small_body_but_redacts_credentials():
    out = handler._redactEventForLog(_event("/sites", json.dumps({"url": "https://example.com"})))
    assert "example.com" in out["body"]
    assert out["headers"]["Authorization"] == "<redacted>"
    assert out["headers"]["Cookie"] == "<redacted>"


def test_large_non_finance_body_summarised():
    out = handler._redactEventForLog(_event("/memes", "x" * 2500))
    assert out["body"] == "<2500 chars>"


def test_original_event_not_mutated():
    ev = _event("/finances/transactions", '{"payee":"p"}', "q=x")
    handler._redactEventForLog(ev)
    assert ev["body"] == '{"payee":"p"}' and ev["headers"]["Authorization"] == "Bearer eyJsecret"


def test_handler_log_line_has_no_finance_values(caplog):
    caplog.set_level(logging.INFO, logger=handler.logger.name)
    handler.handler(_event("/finances/accounts", json.dumps({"accountNumber": "99887766"})), None)
    assert "99887766" not in caplog.text
    assert "eyJsecret" not in caplog.text
