"""Unit tests for api.handler."""
import os
import sys
from pathlib import Path

import pytest

# Allow importing api and common when running tests from repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def healthEvent():
    """API Gateway HTTP API 2.0 payload for GET /health."""
    return {
        "version": "2.0",
        "routeKey": "GET /health",
        "rawPath": "/health",
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/health",
            }
        },
    }


@pytest.fixture
def sitesEvent():
    """API Gateway HTTP API 2.0 payload for GET /sites."""
    return {
        "version": "2.0",
        "routeKey": "GET /sites",
        "rawPath": "/sites",
        "requestContext": {
            "http": {
                "method": "GET",
                "path": "/sites",
            }
        },
    }


def test_health_returns_ok(healthEvent):
    from api.handler import handler
    result = handler(healthEvent, None)
    assert result["statusCode"] == 200
    assert "Access-Control-Allow-Origin" in result["headers"]
    assert "ok" in result["body"]
    assert "true" in result["body"]


def test_sites_returns_json(sitesEvent):
    os.environ["TABLE_NAME"] = "fus-main"
    try:
        from api.handler import handler
        result = handler(sitesEvent, None)
        assert result["statusCode"] in (200, 500)
        assert "sites" in result["body"]
    finally:
        os.environ.pop("TABLE_NAME", None)


def test_unknown_route_returns_404():
    from api.handler import handler
    event = {
        "rawPath": "/unknown",
        "requestContext": {"http": {"method": "GET", "path": "/unknown"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 404
