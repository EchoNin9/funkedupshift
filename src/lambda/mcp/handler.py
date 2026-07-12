"""
Finances MCP server lambda. Minimal MCP over Streamable HTTP as plain
JSON-RPC 2.0: initialize / notifications/initialized / tools/list /
tools/call, one JSON response per POST (no SSE).

ponytail: no MCP SDK dependency — lambdas are stdlib-only and this protocol
subset is small; upgrade path is packaging the `mcp` pip package if the
subset falls short with real clients.

Auth: bearer token (MCP_BEARER_TOKEN) checked with hmac.compare_digest on
every request; the API Gateway route has no Cognito authorizer. Single-owner
by design: all reads are scoped to MCP_OWNER_USER_ID (Adam's Cognito sub).
ponytail: single-owner token; per-user tokens if anyone else ever needs MCP.
"""
import hmac
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import bpf, era_client  # noqa: E402

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SERVER_INFO = {"name": "funkedupshift-finances", "version": "1.0.0"}
DEFAULT_PROTOCOL_VERSION = "2025-03-26"

TOOLS = [
    {
        "name": "list_accounts",
        "description": "List all finance accounts (manual + Era) with balances.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_transactions",
        "description": "List transactions (manual + Era), newest first. Dates are YYYY-MM-DD.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "from": {"type": "string", "description": "start date (inclusive)"},
                "to": {"type": "string", "description": "end date (inclusive)"},
                "query": {"type": "string", "description": "text match on payee/notes/category"},
                "category": {"type": "string"},
            },
        },
    },
    {
        "name": "get_budgets",
        "description": "Per-category monthly budgets with month-to-date actual spend.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_insights",
        "description": "Spending by category, period-vs-period comparison and cash-flow forecast. Period is YYYY-MM (default: current month).",
        "inputSchema": {"type": "object", "properties": {"period": {"type": "string"}}},
    },
    {
        "name": "get_dashboard_summary",
        "description": "Net worth, account balances and 30-day cash flow.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "era_status",
        "description": "Whether the read-only Era.app integration is connected.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _http(status, body=None):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body) if body is not None else "",
    }


def _result(req_id, result):
    return _http(200, {"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code, message, status=200):
    return _http(status, {"jsonrpc": "2.0", "id": req_id,
                          "error": {"code": code, "message": message}})


def _call_tool(name, args):
    """Run one read-only tool for the configured owner. Returns JSON-able payload."""
    owner = os.environ.get("MCP_OWNER_USER_ID", "")
    if not owner:
        raise RuntimeError("MCP_OWNER_USER_ID is not configured")
    if name == "list_accounts":
        return {"accounts": bpf.list_accounts(owner) + era_client.get_accounts()}
    if name == "list_transactions":
        return bpf.transactions_payload(
            owner,
            from_date=args.get("from"),
            to_date=args.get("to"),
            q=args.get("query"),
            category=args.get("category"),
        )
    if name == "get_budgets":
        return {"budgets": bpf.get_budgets(owner)}
    if name == "get_insights":
        return bpf.insights_payload(owner, args.get("period"))
    if name == "get_dashboard_summary":
        return bpf.overview_payload(owner)
    if name == "era_status":
        return {"eraConnected": era_client.is_connected()}
    return None


def handler(event, context):
    """POST /mcp — bearer-auth JSON-RPC 2.0 endpoint."""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    auth = headers.get("authorization", "")
    supplied = auth[7:] if auth.startswith("Bearer ") else ""
    expected = os.environ.get("MCP_BEARER_TOKEN", "")
    if not expected or not supplied or not hmac.compare_digest(supplied, expected):
        return _http(401, {"error": "Unauthorized"})

    try:
        req = json.loads(event.get("body") or "")
    except (json.JSONDecodeError, TypeError):
        return _error(None, -32700, "Parse error", status=400)
    if not isinstance(req, dict):
        return _error(None, -32600, "Batch requests are not supported", status=400)

    method = req.get("method", "")
    req_id = req.get("id")
    params = req.get("params") or {}

    if method == "initialize":
        return _result(req_id, {
            "protocolVersion": params.get("protocolVersion") or DEFAULT_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": SERVER_INFO,
        })
    if method == "notifications/initialized":
        return _http(202)
    if method == "tools/list":
        return _result(req_id, {"tools": TOOLS})
    if method == "tools/call":
        name = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            payload = _call_tool(name, args)
        except Exception as e:
            logger.exception("tool %s failed: %s", name, e)
            return _result(req_id, {
                "content": [{"type": "text", "text": f"Tool error: {e}"}],
                "isError": True,
            })
        if payload is None:
            return _error(req_id, -32602, f"Unknown tool: {name}")
        return _result(req_id, {
            "content": [{"type": "text", "text": json.dumps(payload)}]
        })
    return _error(req_id, -32601, f"Method not found: {method}")
