"""Unit tests for general expenses handlers and module."""
import json
from unittest.mock import patch

from api import general_expenses


def _event(path, method="GET", body=None):
    return {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "pathParameters": {},
        "body": json.dumps(body) if body is not None else None,
    }


def _expenses_user_event(path, method="GET", body=None):
    event = _event(path, method, body)
    event["requestContext"] = {
        "http": {"method": method, "path": path},
        "authorizer": {
            "jwt": {
                "claims": {
                    "sub": "user-genexp-123",
                    "email": "genexp@example.com",
                    "cognito:groups": '["user"]',
                }
            }
        },
    }
    return event


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_list_general_expenses_forbidden_without_group(mock_groups):
    from api.handler import handler

    event = _expenses_user_event("/general-expenses")
    resp = handler(event, None)
    assert resp["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.list_sections", return_value=[{"id": "s1", "name": "Office"}])
def test_list_general_expense_sections_ok(mock_list, mock_groups):
    from api.handler import handler

    event = _expenses_user_event("/general-expenses")
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert data["sections"] == [{"id": "s1", "name": "Office"}]


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.create_section", return_value={"id": "s1", "name": "Travel", "createdAt": "t", "updatedAt": "t"})
def test_create_general_expense_section_ok(mock_create, mock_groups):
    from api.handler import handler

    event = _expenses_user_event("/general-expenses", method="POST", body={"name": "Travel"})
    resp = handler(event, None)
    assert resp["statusCode"] == 201
    data = json.loads(resp["body"])
    assert data["id"] == "s1"
    assert data["name"] == "Travel"


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.list_entries", return_value=[
    {"id": "e1", "date": "2026-04-01", "price": 42.5, "vendor": "Acme", "description": "Supplies", "reimbursed": False, "attachments": []},
])
def test_list_general_expense_entries_ok(mock_list, mock_groups):
    from api.handler import handler

    event = _expenses_user_event("/general-expenses/s1/entries")
    event["pathParameters"] = {"sectionId": "s1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert len(data["entries"]) == 1
    assert data["entries"][0]["vendor"] == "Acme"


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.create_entry", return_value=(None, "date must be YYYY-MM-DD"))
def test_create_general_expense_entry_validation(mock_create, mock_groups):
    from api.handler import handler

    event = _expenses_user_event(
        "/general-expenses/s1/entries",
        method="POST",
        body={"date": "bad", "price": 1, "vendor": "x"},
    )
    event["pathParameters"] = {"sectionId": "s1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 400
    data = json.loads(resp["body"])
    assert "date" in data["error"].lower()


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.get_attachment_upload", return_value={
    "uploadUrl": "https://example.com/put",
    "key": "general-expenses/u/s1/f.pdf",
    "filename": "f.pdf",
    "contentType": "application/pdf",
})
def test_general_expense_upload_url(mock_upload, mock_groups):
    from api.handler import handler

    event = _expenses_user_event(
        "/general-expenses/s1/entries/upload",
        method="POST",
        body={"filename": "f.pdf", "contentType": "application/pdf"},
    )
    event["pathParameters"] = {"sectionId": "s1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert data["uploadUrl"] == "https://example.com/put"
    assert "key" in data


@patch("api.handler._getUserCustomGroups", return_value=["Expenses"])
@patch("api.general_expenses.get_entry", return_value=None)
def test_delete_general_expense_entry_not_found(mock_get, mock_groups):
    from api.handler import handler

    event = _expenses_user_event("/general-expenses/s1/entries/e1", method="DELETE")
    event["pathParameters"] = {"sectionId": "s1", "entryId": "e1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 404


def test_create_entry_validates_date():
    with patch.object(general_expenses, "TABLE_NAME", "t"), patch.object(general_expenses, "get_section", return_value={"id": "s1"}):
        out, msg = general_expenses.create_entry("u1", "s1", {"date": "99-99-99", "price": 1, "vendor": ""})
        assert out is None
        assert "date" in (msg or "").lower()


def test_add_attachment_urls_adds_presigned():
    entries = [{"attachments": [{"key": "k1", "filename": "a.png"}]}]

    class FakeS3:
        def generate_presigned_url(self, *args, **kwargs):
            return "https://signed.example/get"

    with patch.object(general_expenses, "MEDIA_BUCKET", "bucket"), patch("boto3.client", return_value=FakeS3()):
        general_expenses._add_attachment_urls(entries)
    assert entries[0]["attachments"][0]["url"] == "https://signed.example/get"
