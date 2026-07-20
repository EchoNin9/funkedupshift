"""Unit tests for the text-paste sharing tool (src/lambda/tools/handler.py).

Mirrors test_tools_shortener.py's mocking style: `_ddb`/`_kvsClient` there ->
`_textDdb` here, a separate cached client on a separate (ca-central-1) table.
"""
import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, sub="user-123", query=None, authed=True):
    """Build an API Gateway v2 event. authed=False omits requestContext.authorizer
    entirely, matching what a real unauthenticated request to the public
    GET /tools/text/{id} route looks like (no JWT authorizer configured on
    that route at all — see infra/tools.tf toolsTextGetPublic)."""
    request_context = {"http": {"method": method, "path": path}}
    if authed:
        request_context["authorizer"] = {"jwt": {"claims": {"sub": sub, "email": "user@example.com"}}}
    event = {
        "rawPath": path,
        "requestContext": request_context,
        "headers": {},
        "body": json.dumps(body) if body is not None else "{}",
    }
    if query is not None:
        event["queryStringParameters"] = query
    return event


def _ddb_item(text_id, content, created_by, created_at="2026-07-01T00:00:00Z", expires_at=None):
    if expires_at is None:
        expires_at = int(time.time()) + 7 * 86400
    return {
        "id": {"S": text_id},
        "kind": {"S": "text"},
        "content": {"S": content},
        "createdBy": {"S": created_by},
        "createdAt": {"S": created_at},
        "expiresAt": {"N": str(expires_at)},
    }


# --- mint: happy path --------------------------------------------------------


def test_mint_valid_content_returns_id_and_defaults_to_7d_ttl():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.return_value = {}

    before = int(time.time())
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(
            _event("/tools/text", "POST", {"content": "hello world"}), None
        )
    after = int(time.time())

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert len(payload["id"]) >= 22
    assert payload["kind"] == "text"
    expected_min = before + 7 * 86400
    expected_max = after + 7 * 86400
    assert expected_min <= payload["expiresAt"] <= expected_max

    ddb.put_item.assert_called_once()
    put_kwargs = ddb.put_item.call_args.kwargs
    assert put_kwargs["Item"]["kind"]["S"] == "text"
    assert put_kwargs["Item"]["content"]["S"] == "hello world"
    assert put_kwargs["Item"]["expiresAt"]["N"] == str(payload["expiresAt"])


def test_mint_custom_expiry_within_bounds():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.put_item.return_value = {}

    before = int(time.time())
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(
            _event("/tools/text", "POST", {"content": "hi", "expiresInSeconds": 3600}), None
        )

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert before + 3600 <= payload["expiresAt"] <= before + 3600 + 5


# --- mint: validation ---------------------------------------------------------


def test_mint_content_too_big_400():
    from tools import handler as tools_handler

    ddb = MagicMock()
    huge = "a" * (100 * 1024 + 1)
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(_event("/tools/text", "POST", {"content": huge}), None)

    assert result["statusCode"] == 400
    ddb.put_item.assert_not_called()


def test_mint_empty_content_400():
    from tools import handler as tools_handler

    for body in [{"content": ""}, {"content": "   "}, {}, {"content": None}, {"content": 123}]:
        result = tools_handler.handler(_event("/tools/text", "POST", body), None)
        assert result["statusCode"] == 400, body


def test_mint_invalid_json_body_400():
    from tools import handler as tools_handler

    event = _event("/tools/text", "POST")
    event["body"] = "{not json"
    result = tools_handler.handler(event, None)
    assert result["statusCode"] == 400


def test_mint_expiry_out_of_bounds_400():
    from tools import handler as tools_handler

    ddb = MagicMock()
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        for expires_in in [0, 60, 3599, 30 * 86400 + 1, 999999999]:
            result = tools_handler.handler(
                _event("/tools/text", "POST", {"content": "hi", "expiresInSeconds": expires_in}), None
            )
            assert result["statusCode"] == 400, expires_in
        ddb.put_item.assert_not_called()


def test_mint_expiry_not_a_number_400():
    from tools import handler as tools_handler

    result = tools_handler.handler(
        _event("/tools/text", "POST", {"content": "hi", "expiresInSeconds": "soon"}), None
    )
    assert result["statusCode"] == 400


# --- public GET: /tools/text/{id} ---------------------------------------------


def test_public_get_happy_path_without_any_authorizer_in_event():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc123xyz0123456789012", "shared text", "user-123")}

    event = _event("/tools/text/abc123xyz0123456789012", "GET", authed=False)
    assert "authorizer" not in event["requestContext"]

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(event, None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload == {
        "id": "abc123xyz0123456789012",
        "kind": "text",
        "content": "shared text",
        "expiresAt": payload["expiresAt"],
    }
    # createdBy must never be exposed on the public route.
    assert "createdBy" not in payload


def test_public_get_expired_item_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    expired = int(time.time()) - 10
    ddb.get_item.return_value = {"Item": _ddb_item("expiredid0123456789012", "old", "user-123", expires_at=expired)}

    event = _event("/tools/text/expiredid0123456789012", "GET", authed=False)
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(event, None)

    assert result["statusCode"] == 404


def test_public_get_unknown_id_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {}

    event = _event("/tools/text/doesnotexist0123456789", "GET", authed=False)
    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(event, None)

    assert result["statusCode"] == 404


# --- delete: DELETE /tools/text/{id} -------------------------------------------


def test_delete_by_creator_ok():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc123xyz0123456789012", "mine", "user-123")}

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(
            _event("/tools/text/abc123xyz0123456789012", "DELETE", sub="user-123"), None
        )

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload["deleted"] is True
    ddb.delete_item.assert_called_once()


def test_delete_by_non_creator_forbidden_without_leaking_content():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {"Item": _ddb_item("abc123xyz0123456789012", "top secret stuff", "someone-else")}

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(
            _event("/tools/text/abc123xyz0123456789012", "DELETE", sub="user-123"), None
        )

    assert result["statusCode"] in (403, 404)
    assert "top secret stuff" not in result["body"]
    ddb.delete_item.assert_not_called()


def test_delete_unknown_id_404():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.get_item.return_value = {}

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(_event("/tools/text/doesnotexist0123456789", "DELETE"), None)

    assert result["statusCode"] == 404


# --- list: GET /tools/text ------------------------------------------------------


def test_list_returns_only_callers_items():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.query.return_value = {
        "Items": [
            _ddb_item("mine0001xyz0123456789012", "content 1", "user-123", created_at="2026-07-15T00:00:00Z"),
            _ddb_item("mine0002xyz0123456789012", "content 2", "user-123", created_at="2026-07-01T00:00:00Z"),
        ]
    }

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(_event("/tools/text", "GET", sub="user-123"), None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    ids = [item["id"] for item in payload["items"]]
    assert ids == ["mine0001xyz0123456789012", "mine0002xyz0123456789012"]
    # List rows omit content (matches shortener list-shape; content is only
    # returned by the single-item public GET).
    assert all("content" not in item for item in payload["items"])

    query_kwargs = ddb.query.call_args.kwargs
    assert query_kwargs["IndexName"] == "byCreator"
    assert query_kwargs["ExpressionAttributeValues"][":sub"] == {"S": "user-123"}


def test_list_empty_for_new_user():
    from tools import handler as tools_handler

    ddb = MagicMock()
    ddb.query.return_value = {"Items": []}

    with patch.object(tools_handler, "_textDdb", return_value=ddb):
        result = tools_handler.handler(_event("/tools/text", "GET", sub="brand-new-user"), None)

    assert result["statusCode"] == 200
    payload = json.loads(result["body"])
    assert payload["items"] == []


def test_unknown_text_route_404():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event("/tools/nope", "GET"), None)
    assert result["statusCode"] == 404
