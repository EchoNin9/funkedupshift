"""Unit tests for Internet Dashboard API handler."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path="/internet-dashboard", method="GET"):
    """Event for GET /internet-dashboard (no auth required)."""
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
    }


@patch("api.internet_dashboard.fetchDashboard")
def test_getInternetDashboard_returns_sites(mock_fetch):
    """GET /internet-dashboard returns sites array when fetch succeeds."""
    from api.handler import handler

    mock_fetch.return_value = [
        {"domain": "google.com", "status": "up", "source": "http", "responseTimeMs": 120},
        {"domain": "github.com", "status": "up", "source": "http", "responseTimeMs": 85},
    ]

    event = _event()
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "sites" in body
    assert len(body["sites"]) == 2
    assert body["sites"][0]["domain"] == "google.com"
    assert body["sites"][0]["status"] == "up"
    mock_fetch.assert_called_once()


@patch("api.internet_dashboard.fetchDashboard")
def test_getInternetDashboard_fallback_on_error(mock_fetch):
    """GET /internet-dashboard returns 500 with sites=[] when fetch raises."""
    from api.handler import handler

    mock_fetch.side_effect = Exception("Network error")

    event = _event()
    result = handler(event, None)

    assert result["statusCode"] == 500
    body = json.loads(result["body"])
    assert "sites" in body
    assert body["sites"] == []
    assert "error" in body
