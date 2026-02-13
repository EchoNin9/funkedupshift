"""Unit tests for Financial API handlers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, sub="user-123", groups="user"):
    """Event with JWT authorizer."""
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": {},
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": sub,
                        "email": "user@example.com",
                        "cognito:groups": groups,
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def _admin_event(path, method="GET", body=None):
    """Event with admin (SuperAdmin) JWT authorizer."""
    return _event(path, method, body, sub="admin-123", groups="admin")


def _manager_financial_event(path, method="GET", body=None):
    """Event with manager in Financial group."""
    return _event(path, method, body, sub="manager-123", groups="manager")


def test_getFinancialWatchlist_requires_auth():
    """GET /financial/watchlist without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/financial/watchlist",
        "requestContext": {"http": {"method": "GET", "path": "/financial/watchlist"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.financial.get_user_watchlist", return_value=["AAPL", "GOOGL"])
def test_getFinancialWatchlist_user_can_access(mock_watchlist):
    """GET /financial/watchlist as any logged-in user can access."""
    from api.handler import handler
    event = _event("/financial/watchlist")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL", "GOOGL"]


@patch("api.financial.get_user_watchlist", return_value=["AAPL", "GOOGL"])
def test_getFinancialWatchlist_admin_can_access(mock_watchlist):
    """GET /financial/watchlist as SuperAdmin can access."""
    from api.handler import handler
    event = _admin_event("/financial/watchlist")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL", "GOOGL"]


@patch("api.financial.save_user_watchlist", return_value=True)
def test_putFinancialWatchlist_saves_symbols(mock_save):
    """PUT /financial/watchlist saves user watchlist (any logged-in user)."""
    from api.handler import handler
    event = _event("/financial/watchlist", method="PUT", body={"symbols": ["AAPL", "MSFT"]})
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL", "MSFT"]


def test_getFinancialQuote_requires_symbol():
    """GET /financial/quote without symbol returns 400 (public endpoint)."""
    from api.handler import handler
    event = {"rawPath": "/financial/quote", "queryStringParameters": {}, "requestContext": {"http": {"method": "GET", "path": "/financial/quote"}}}
    result = handler(event, None)
    assert result["statusCode"] == 400


@patch("api.financial.fetch_quote", return_value={
    "symbol": "AAPL",
    "price": 150.25,
    "change": 2.5,
    "changePercent": 1.69,
    "source": "yahoo",
})
def test_getFinancialQuote_returns_quote(mock_fetch):
    """GET /financial/quote returns quote data (public, no auth required)."""
    from api.handler import handler
    event = {"rawPath": "/financial/quote", "queryStringParameters": {"symbol": "AAPL"}, "requestContext": {"http": {"method": "GET", "path": "/financial/quote"}}}
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbol"] == "AAPL"
    assert body["price"] == 150.25


def test_getFinancialConfig_public_no_auth():
    """GET /financial/config returns default symbols without auth (public for guests)."""
    from api.handler import handler
    with patch("api.financial.get_financial_config", return_value={"symbols": ["AAPL", "MSFT"], "source": "yahoo"}):
        event = {"rawPath": "/financial/config", "requestContext": {"http": {"method": "GET", "path": "/financial/config"}}}
        result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL", "MSFT"]
    assert "availableSources" in body


def test_getFinancialDefaultSymbols_requires_admin():
    """GET /admin/financial/default-symbols as regular user returns 403."""
    from api.handler import handler
    event = _event("/admin/financial/default-symbols")
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.financial.get_financial_config", return_value={"symbols": ["AAPL"], "source": "yahoo"})
def test_getFinancialDefaultSymbols_admin_can_access(mock_config):
    """GET /admin/financial/default-symbols as SuperAdmin can access."""
    from api.handler import handler
    event = _admin_event("/admin/financial/default-symbols")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL"]
    assert body["source"] == "yahoo"


def test_putFinancialDefaultSymbols_manager_denied():
    """PUT /admin/financial/default-symbols as Manager returns 403 (SuperAdmin only)."""
    from api.handler import handler
    event = _manager_financial_event(
        "/admin/financial/default-symbols",
        method="PUT",
        body={"symbols": ["AAPL", "GOOGL"], "source": "yahoo"}
    )
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.financial.save_financial_config", return_value=True)
def test_putFinancialDefaultSymbols_superadmin_can_save(mock_save):
    """PUT /admin/financial/default-symbols as SuperAdmin can save."""
    from api.handler import handler
    event = _admin_event(
        "/admin/financial/default-symbols",
        method="PUT",
        body={"symbols": ["AAPL", "GOOGL"], "source": "yahoo"}
    )
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbols"] == ["AAPL", "GOOGL"]
