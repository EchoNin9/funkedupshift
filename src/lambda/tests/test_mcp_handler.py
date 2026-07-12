"""Unit tests for the finances MCP server lambda."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

TOKEN = "test-mcp-token"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MCP_BEARER_TOKEN", TOKEN)
    monkeypatch.setenv("MCP_OWNER_USER_ID", "owner-sub-1")


def _event(payload, token=TOKEN):
    headers = {"content-type": "application/json"}
    if token is not None:
        headers["authorization"] = f"Bearer {token}"
    return {
        "rawPath": "/mcp",
        "headers": headers,
        "requestContext": {"http": {"method": "POST", "path": "/mcp"}},
        "body": json.dumps(payload) if isinstance(payload, (dict, list)) else payload,
    }


def _rpc(method, params=None, req_id=1):
    msg = {"jsonrpc": "2.0", "method": method, "id": req_id}
    if params is not None:
        msg["params"] = params
    return msg


def test_missing_token_401():
    from mcp.handler import handler
    assert handler(_event(_rpc("tools/list"), token=None), None)["statusCode"] == 401


def test_bad_token_401():
    from mcp.handler import handler
    assert handler(_event(_rpc("tools/list"), token="wrong"), None)["statusCode"] == 401


def test_unconfigured_token_rejects_everything(monkeypatch):
    monkeypatch.setenv("MCP_BEARER_TOKEN", "")
    from mcp.handler import handler
    assert handler(_event(_rpc("tools/list"), token=""), None)["statusCode"] == 401


def test_initialize_handshake():
    from mcp.handler import handler
    result = handler(_event(_rpc("initialize", {"protocolVersion": "2025-06-18"})), None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["result"]["protocolVersion"] == "2025-06-18"
    assert body["result"]["capabilities"] == {"tools": {}}
    assert body["result"]["serverInfo"]["name"]


def test_notifications_initialized_202():
    from mcp.handler import handler
    result = handler(_event(_rpc("notifications/initialized")), None)
    assert result["statusCode"] == 202


def test_tools_list_has_six_tools():
    from mcp.handler import handler
    result = handler(_event(_rpc("tools/list")), None)
    body = json.loads(result["body"])
    names = [t["name"] for t in body["result"]["tools"]]
    assert names == ["list_accounts", "list_transactions", "get_budgets",
                     "get_insights", "get_dashboard_summary", "era_status"]


@patch("api.era_client.get_accounts", return_value=[])
@patch("api.bpf.list_accounts", return_value=[{"id": "a1", "name": "Chequing", "balance": 5.0}])
def test_tools_call_list_accounts(mock_local, mock_era):
    from mcp.handler import handler
    result = handler(_event(_rpc("tools/call", {"name": "list_accounts", "arguments": {}})), None)
    body = json.loads(result["body"])
    payload = json.loads(body["result"]["content"][0]["text"])
    assert payload["accounts"][0]["id"] == "a1"
    mock_local.assert_called_once_with("owner-sub-1")


@patch("api.bpf.transactions_payload", return_value={"transactions": [], "eraConnected": False})
def test_tools_call_list_transactions_args(mock_payload):
    from mcp.handler import handler
    handler(_event(_rpc("tools/call", {
        "name": "list_transactions",
        "arguments": {"from": "2026-01-01", "query": "cafe"},
    })), None)
    mock_payload.assert_called_once_with(
        "owner-sub-1", from_date="2026-01-01", to_date=None, q="cafe", category=None)


def test_tools_call_era_status():
    from mcp.handler import handler
    result = handler(_event(_rpc("tools/call", {"name": "era_status", "arguments": {}})), None)
    payload = json.loads(json.loads(result["body"])["result"]["content"][0]["text"])
    assert payload == {"eraConnected": False}


def test_tools_call_unknown_tool():
    from mcp.handler import handler
    result = handler(_event(_rpc("tools/call", {"name": "delete_everything"})), None)
    body = json.loads(result["body"])
    assert body["error"]["code"] == -32602


@patch("api.bpf.get_budgets", side_effect=RuntimeError("ddb down"))
def test_tools_call_tool_error_is_iserror(mock_budgets):
    from mcp.handler import handler
    result = handler(_event(_rpc("tools/call", {"name": "get_budgets"})), None)
    body = json.loads(result["body"])
    assert body["result"]["isError"] is True


def test_unknown_method_rpc_error():
    from mcp.handler import handler
    result = handler(_event(_rpc("resources/list")), None)
    body = json.loads(result["body"])
    assert body["error"]["code"] == -32601


def test_invalid_json_parse_error():
    from mcp.handler import handler
    result = handler(_event("{not json"), None)
    assert result["statusCode"] == 400
    assert json.loads(result["body"])["error"]["code"] == -32700
