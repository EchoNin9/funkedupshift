"""Tests for visitor_network (ipwho server-side fetch)."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def test_fetch_ipwho_for_ip_rejects_empty():
    from api.visitor_network import fetch_ipwho_for_ip

    with pytest.raises(ValueError, match="empty"):
        fetch_ipwho_for_ip("")


def test_fetch_ipwho_for_ip_rejects_invalid():
    from api.visitor_network import fetch_ipwho_for_ip

    with pytest.raises(ValueError, match="invalid"):
        fetch_ipwho_for_ip("not-an-ip")


def test_fetch_ipwho_for_ip_rejects_ssrf_path():
    from api.visitor_network import fetch_ipwho_for_ip

    with pytest.raises(ValueError, match="invalid"):
        fetch_ipwho_for_ip("8.8.8.8/../../../evil")


@patch("api.visitor_network.urlopen")
def test_fetch_ipwho_for_ip_parses_json(mock_urlopen):
    from api.visitor_network import fetch_ipwho_for_ip

    payload = {"success": True, "ip": "8.8.8.8", "country": "United States"}
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps(payload).encode()
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock_urlopen.return_value = mock_resp

    out = fetch_ipwho_for_ip("8.8.8.8")
    assert out["success"] is True
    assert out["ip"] == "8.8.8.8"
    mock_urlopen.assert_called_once()
    called_url = mock_urlopen.call_args[0][0].full_url
    assert "8.8.8.8" in called_url


def _handler_event(path="/visitor-network-info", method="GET", source_ip="1.1.1.1"):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path, "sourceIp": source_ip}},
    }


@patch("api.visitor_network.fetch_ipwho_for_ip")
def test_getVisitorNetworkInfo_returns_ipwho(mock_fetch):
    from api.handler import handler

    mock_fetch.return_value = {"success": True, "ip": "1.1.1.1", "country": "Australia"}

    result = handler(_handler_event(), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["success"] is True
    assert body["country"] == "Australia"
    mock_fetch.assert_called_once_with("1.1.1.1")


@patch("api.visitor_network.fetch_ipwho_for_ip")
def test_getVisitorNetworkInfo_502_on_fetch_error(mock_fetch):
    from api.handler import handler

    mock_fetch.side_effect = OSError("timeout")

    result = handler(_handler_event(), None)
    assert result["statusCode"] == 502
    body = json.loads(result["body"])
    assert body["success"] is False


def test_getVisitorNetworkInfo_503_no_source_ip():
    from api.handler import handler

    event = {
        "rawPath": "/visitor-network-info",
        "requestContext": {"http": {"method": "GET", "path": "/visitor-network-info"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 503
    body = json.loads(result["body"])
    assert body["success"] is False
