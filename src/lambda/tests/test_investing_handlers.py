"""Unit tests for Investing API handlers."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, query=None, sub="user-123", groups="user"):
    """Event with JWT authorizer."""
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": query or {},
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


def _admin_event(path, method="GET", body=None, query=None):
    return _event(path, method, body, query, sub="admin-123", groups="admin")


def test_investing_requires_auth():
    """GET /investing/tracker without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/investing/tracker",
        "requestContext": {"http": {"method": "GET", "path": "/investing/tracker"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.handler._getUserCustomGroups", return_value=["Memes"])
def test_investing_requires_financial_group(mock_groups):
    """User outside the Financial custom group gets 403."""
    from api.handler import handler
    result = handler(_event("/investing/tracker"), None)
    assert result["statusCode"] == 403


@patch("api.investing.search_symbols", return_value=[
    {"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NMS", "exchDisp": "NASDAQ", "quoteType": "EQUITY"},
])
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_getInvestingSearch(mock_groups, mock_search):
    from api.handler import handler
    result = handler(_event("/investing/search", query={"q": "apple"}), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["results"][0]["symbol"] == "AAPL"


@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_getInvestingSearch_requires_q(mock_groups):
    from api.handler import handler
    result = handler(_event("/investing/search"), None)
    assert result["statusCode"] == 400


@patch("api.investing.suggest_tickers", return_value=[
    {"symbol": "GDX", "name": "VanEck Gold Miners ETF", "exchange": "PCX", "exchDisp": "NYSEArca", "quoteType": "ETF"},
])
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_postInvestingSuggest(mock_groups, mock_suggest):
    from api.handler import handler
    result = handler(_event("/investing/suggest", method="POST", body={"query": "gold miners"}), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["results"][0]["symbol"] == "GDX"


@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_postInvestingSuggest_requires_query(mock_groups):
    from api.handler import handler
    result = handler(_event("/investing/suggest", method="POST", body={}), None)
    assert result["statusCode"] == 400


@patch("api.investing.get_ticker_data", return_value={
    "symbol": "AAPL",
    "meta": {"price": 150.0, "currency": "USD", "exchangeName": "NasdaqGS", "name": "Apple Inc."},
    "candles": [{"t": 1700000000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}],
    "pe": {"trailingPE": 28.5, "forwardPE": 25.1},
})
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_getInvestingTicker(mock_groups, mock_data):
    from api.handler import handler
    result = handler(_event("/investing/ticker", query={"symbol": "AAPL", "range": "1y"}), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["symbol"] == "AAPL"
    assert body["pe"]["trailingPE"] == 28.5
    assert len(body["candles"]) == 1


@patch("api.investing.get_ticker_data", return_value=None)
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_getInvestingTicker_not_found(mock_groups, mock_data):
    from api.handler import handler
    result = handler(_event("/investing/ticker", query={"symbol": "NOPE123"}), None)
    assert result["statusCode"] == 404


@patch("api.investing.analyze_ticker", return_value={"symbol": "AAPL", "analysis": "Looks fine. Not financial advice."})
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_postInvestingAnalyze(mock_groups, mock_analyze):
    from api.handler import handler
    result = handler(_event("/investing/analyze", method="POST", body={"symbol": "AAPL"}), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "analysis" in body


@patch("api.investing.get_tracker", return_value=["AAPL", "GC=F"])
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_getInvestingTracker(mock_groups, mock_tracker):
    from api.handler import handler
    result = handler(_event("/investing/tracker"), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["symbols"] == ["AAPL", "GC=F"]


@patch("api.investing.save_tracker", return_value=True)
@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_putInvestingTracker(mock_groups, mock_save):
    from api.handler import handler
    result = handler(_event("/investing/tracker", method="PUT", body={"symbols": ["aapl", "GLD"]}), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["symbols"] == ["AAPL", "GLD"]


@patch("api.handler._getUserCustomGroups", return_value=["Financial"])
def test_putInvestingTracker_validates_body(mock_groups):
    from api.handler import handler
    result = handler(_event("/investing/tracker", method="PUT", body={"symbols": "AAPL"}), None)
    assert result["statusCode"] == 400


def test_investing_admin_bypasses_group():
    """SuperAdmin can access without Financial custom group."""
    from api.handler import handler
    with patch("api.investing.get_tracker", return_value=[]):
        result = handler(_admin_event("/investing/tracker"), None)
    assert result["statusCode"] == 200


# --- suggest parsing unit tests -------------------------------------------

def test_parse_ticker_array_prose_wrapped():
    from api.investing import _parse_ticker_array
    text = 'Here are some tickers: ["AAPL", "gld", "GC=F"] hope that helps'
    assert _parse_ticker_array(text) == ["AAPL", "GLD", "GC=F"]


def test_parse_ticker_array_garbage():
    from api.investing import _parse_ticker_array
    assert _parse_ticker_array("no json here") == []
    assert _parse_ticker_array("") == []
    assert _parse_ticker_array('{"not": "an array"}') == []


def test_suggest_tickers_drops_hallucinations():
    from api import investing
    with patch.object(investing, "_converse", return_value='["AAPL", "FAKE99"]'), \
         patch.object(investing, "search_symbols", side_effect=lambda s: (
             [{"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NMS", "exchDisp": "NASDAQ", "quoteType": "EQUITY"}]
             if s == "AAPL" else []
         )):
        results = investing.suggest_tickers("big tech")
    assert [r["symbol"] for r in results] == ["AAPL"]
