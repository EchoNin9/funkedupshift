"""Unit tests for Our Properties API handler."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path="/recommended/highlights", method="GET"):
    """Event for GET /recommended/highlights (no auth required)."""
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
    }


def _admin_event(path="/admin/recommended/highlights/sites", method="GET"):
    """Event for admin routes (requires auth)."""
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user-123",
                        "cognito:groups": json.dumps(["manager"]),
                    }
                }
            },
        },
    }


@patch("api.our_properties.fetch_our_properties")
def test_getOurProperties_returns_sites(mock_fetch):
    """GET /recommended/highlights returns sites array when fetch succeeds."""
    from api.handler import handler

    mock_fetch.return_value = [
        {"url": "https://example.com", "domain": "example.com", "status": "up", "responseTimeMs": 120, "description": "Test site"},
        {"url": "https://mysite.com/path", "domain": "mysite.com", "status": "degraded", "responseTimeMs": 3500, "description": ""},
    ]

    event = _event()
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "sites" in body
    assert len(body["sites"]) == 2
    assert body["sites"][0]["domain"] == "example.com"
    assert body["sites"][0]["url"] == "https://example.com"
    assert body["sites"][0]["status"] == "up"
    assert body["sites"][0]["description"] == "Test site"
    mock_fetch.assert_called_once()


@patch("api.our_properties.fetch_our_properties")
def test_getOurProperties_empty_list(mock_fetch):
    """GET /recommended/highlights returns empty list when no sites."""
    from api.handler import handler

    mock_fetch.return_value = []

    event = _event()
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["sites"] == []


@patch("api.our_properties.fetch_our_properties")
def test_getOurProperties_fallback_on_error(mock_fetch):
    """GET /recommended/highlights returns 500 with sites=[] when fetch raises."""
    from api.handler import handler

    mock_fetch.side_effect = Exception("Network error")

    event = _event()
    result = handler(event, None)

    assert result["statusCode"] == 500
    body = json.loads(result["body"])
    assert "sites" in body
    assert body["sites"] == []
    assert "error" in body


# ------------------------------------------------------------------------------
# GET /recommended/highest-rated (public, no auth)
# ------------------------------------------------------------------------------

def _highest_rated_event(path="/recommended/highest-rated", method="GET"):
    """Event for GET /recommended/highest-rated."""
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
    }


@patch("api.our_properties.fetch_highest_rated")
def test_getHighestRated_returns_sites(mock_fetch):
    """GET /recommended/highest-rated returns sites array when fetch succeeds."""
    from api.handler import handler

    mock_fetch.return_value = [
        {"url": "https://example.com", "domain": "example.com", "status": "up", "averageRating": 4.5},
        {"url": "https://top.com", "domain": "top.com", "status": "up", "averageRating": 5.0},
    ]

    event = _highest_rated_event()
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "sites" in body
    assert len(body["sites"]) == 2
    assert body["sites"][0]["domain"] == "example.com"
    assert body["sites"][0]["averageRating"] == 4.5
    mock_fetch.assert_called_once()


@patch("api.our_properties.fetch_highest_rated")
def test_getHighestRated_empty_list(mock_fetch):
    """GET /recommended/highest-rated returns empty list when no sites."""
    from api.handler import handler

    mock_fetch.return_value = []

    event = _highest_rated_event()
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["sites"] == []


@patch("api.our_properties.fetch_highest_rated")
def test_getHighestRated_fallback_on_error(mock_fetch):
    """GET /recommended/highest-rated returns 500 with sites=[] when fetch raises."""
    from api.handler import handler

    mock_fetch.side_effect = Exception("DynamoDB error")

    event = _highest_rated_event()
    result = handler(event, None)

    assert result["statusCode"] == 500
    body = json.loads(result["body"])
    assert "sites" in body
    assert body["sites"] == []
    assert "error" in body