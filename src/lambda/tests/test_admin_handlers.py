"""Unit tests for admin user & group management API handlers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _admin_event(path, method="GET", body=None):
    """Event with admin (SuperAdmin) JWT authorizer."""
    return {
        "rawPath": path,
        "pathParameters": {},
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "admin-123",
                        "email": "admin@example.com",
                        "cognito:groups": "admin",
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def _manager_event(path, method="GET", body=None):
    """Event with manager JWT authorizer."""
    ev = _admin_event(path, method, body)
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["sub"] = "manager-123"
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["email"] = "manager@example.com"
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "manager"
    return ev


def _user_event(path, method="GET", body=None):
    """Event with regular user JWT authorizer."""
    ev = _admin_event(path, method, body)
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["sub"] = "user-123"
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["email"] = "user@example.com"
    ev["requestContext"]["authorizer"]["jwt"]["claims"]["cognito:groups"] = "user"
    return ev


def test_getMe_returns_groupsDisplay():
    """GET /me returns groupsDisplay with role mapping."""
    from api.handler import handler
    event = _admin_event("/me")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "groupsDisplay" in body
    assert "SuperAdmin" in body["groupsDisplay"] or "admin" in body["groups"]


def test_listAdminUsers_requires_auth():
    """GET /admin/users without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/admin/users",
        "requestContext": {"http": {"method": "GET", "path": "/admin/users"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_listAdminUsers_requires_manager_or_admin():
    """GET /admin/users with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/users")
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.COGNITO_USER_POOL_ID", "us-east-1_abc123")
@patch("boto3.client")
def test_listAdminUsers_returns_users(mock_boto_client):
    """GET /admin/users as admin/manager returns user list."""
    from api.handler import handler
    mock_cognito = MagicMock()
    mock_cognito.list_users.return_value = {
        "Users": [
            {
                "Username": "user@example.com",
                "UserStatus": "CONFIRMED",
                "Enabled": True,
                "Attributes": [
                    {"Name": "sub", "Value": "sub-123"},
                    {"Name": "email", "Value": "user@example.com"},
                ],
            }
        ],
    }
    mock_boto_client.return_value = mock_cognito

    event = _admin_event("/admin/users")
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "users" in body
    assert len(body["users"]) == 1
    assert body["users"][0]["email"] == "user@example.com"


def test_listAdminUsers_fails_without_pool_id():
    """GET /admin/users when COGNITO_USER_POOL_ID not set returns 500."""
    from api.handler import handler
    with patch("api.handler.COGNITO_USER_POOL_ID", ""):
        event = _admin_event("/admin/users")
        result = handler(event, None)
    assert result["statusCode"] == 500


def test_getUserGroups_requires_manager_or_admin():
    """GET /admin/users/{username}/groups with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/users/test@example.com/groups")
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.COGNITO_USER_POOL_ID", "us-east-1_abc123")
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_getUserGroups_returns_groups(mock_boto_client):
    """GET /admin/users/{username}/groups returns cognito and custom groups."""
    from api.handler import handler
    mock_cognito = MagicMock()
    mock_cognito.admin_list_groups_for_user.return_value = {
        "Groups": [{"GroupName": "user"}],
    }
    mock_cognito.admin_get_user.return_value = {
        "UserAttributes": [
            {"Name": "sub", "Value": "sub-123"},
            {"Name": "email", "Value": "test@example.com"},
        ],
    }
    mock_dynamo = MagicMock()
    mock_dynamo.query.return_value = {"Items": []}

    def client_side_effect(service, **kw):
        return mock_cognito if service == "cognito-idp" else mock_dynamo

    mock_boto_client.side_effect = client_side_effect

    event = _admin_event("/admin/users/test@example.com/groups")
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}

    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "cognitoGroups" in body
    assert "customGroups" in body
    assert "user" in body["cognitoGroups"]


def test_addUserToGroup_requires_manager_or_admin():
    """POST /admin/users/{username}/groups with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/users/test@example.com/groups", method="POST", body={"groupName": "manager"})
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_addUserToGroup_admin_requires_superadmin():
    """POST add to admin group as manager returns 403."""
    from api.handler import handler
    event = _manager_event("/admin/users/test@example.com/groups", method="POST", body={"groupName": "admin"})
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 403
    body = json.loads(result["body"])
    assert "SuperAdmin" in body.get("error", "") or "admin" in body.get("error", "").lower()


def test_addUserToGroup_manager_requires_superadmin():
    """POST add to manager group as manager returns 403."""
    from api.handler import handler
    event = _manager_event("/admin/users/test@example.com/groups", method="POST", body={"groupName": "manager"})
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 403
    body = json.loads(result["body"])
    assert "SuperAdmin" in body.get("error", "") or "manager" in body.get("error", "").lower()


def test_addUserToGroup_requires_groupName():
    """POST /admin/users/{username}/groups without groupName returns 400."""
    from api.handler import handler
    event = _admin_event("/admin/users/test@example.com/groups", method="POST", body={})
    event["rawPath"] = "/admin/users/test@example.com/groups"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 400


def test_listAdminGroups_requires_manager_or_admin():
    """GET /admin/groups with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/groups")
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listAdminGroups_returns_groups(mock_boto_client):
    """GET /admin/groups returns custom group list."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.query.return_value = {
        "Items": [
            {
                "PK": {"S": "GROUP#media-editors"},
                "SK": {"S": "METADATA"},
                "name": {"S": "media-editors"},
                "description": {"S": "Can edit media"},
                "entityType": {"S": "GROUP"},
                "entitySk": {"S": "GROUP#media-editors"},
                "permissions": {"L": [{"S": "media:edit"}]},
            }
        ],
    }
    mock_boto_client.return_value = mock_dynamo

    event = _admin_event("/admin/groups")
    result = handler(event, None)

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "groups" in body
    assert len(body["groups"]) == 1
    assert body["groups"][0].get("name") == "media-editors"


def test_createAdminGroup_requires_manager_or_admin():
    """POST /admin/groups with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/groups", method="POST", body={"name": "test-group"})
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_createAdminGroup_requires_name():
    """POST /admin/groups without name returns 400."""
    from api.handler import handler
    event = _admin_event("/admin/groups", method="POST", body={})
    result = handler(event, None)
    assert result["statusCode"] == 400


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createAdminGroup_creates_group(mock_boto_client):
    """POST /admin/groups as admin creates group."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto_client.return_value = mock_dynamo

    event = _admin_event("/admin/groups", method="POST", body={
        "name": "media-editors",
        "description": "Can edit media",
        "permissions": ["media:edit"],
    })
    result = handler(event, None)

    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert body.get("name") == "media-editors"
    mock_dynamo.put_item.assert_called_once()
    call_item = mock_dynamo.put_item.call_args[1]["Item"]
    assert call_item["PK"]["S"] == "GROUP#media-editors"
    assert call_item["entityType"]["S"] == "GROUP"


def test_getProfile_requires_auth():
    """GET /profile without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/profile",
        "requestContext": {"http": {"method": "GET", "path": "/profile"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_putProfile_description_over_100_returns_400():
    """PUT /profile with description over 100 chars returns 400."""
    from api.handler import handler
    event = _admin_event("/profile", method="PUT", body={"description": "x" * 101})
    with patch("api.handler.TABLE_NAME", "fus-main"):
        result = handler(event, None)
    assert result["statusCode"] == 400


def test_deleteAdminGroup_requires_manager_or_admin():
    """DELETE /admin/groups/{name} with user role returns 403."""
    from api.handler import handler
    event = _user_event("/admin/groups/test-group")
    event["rawPath"] = "/admin/groups/test-group"
    event["requestContext"]["http"]["method"] = "DELETE"
    event["pathParameters"] = {"name": "test-group"}
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_removeUserFromGroup_manager_requires_superadmin():
    """DELETE remove from manager group as manager returns 403."""
    from api.handler import handler
    event = _manager_event("/admin/users/test@example.com/groups/manager", method="DELETE")
    event["rawPath"] = "/admin/users/test@example.com/groups/manager"
    event["pathParameters"] = {"username": "test@example.com", "groupName": "manager"}
    result = handler(event, None)
    assert result["statusCode"] == 403
    body = json.loads(result["body"])
    assert "SuperAdmin" in body.get("error", "") or "manager" in body.get("error", "").lower()


def test_deleteAdminUser_requires_superadmin():
    """DELETE /admin/users/{username} as manager returns 403."""
    from api.handler import handler
    event = _manager_event("/admin/users/test@example.com", method="DELETE")
    event["rawPath"] = "/admin/users/test@example.com"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler.TABLE_NAME", "fus-main")
@patch("api.handler.COGNITO_USER_POOL_ID", "us-east-1_abc123")
@patch("boto3.client")
def test_deleteAdminUser_superadmin_deletes_user(mock_boto_client):
    """DELETE /admin/users/{username} as SuperAdmin deletes user."""
    from api.handler import handler
    mock_cognito = MagicMock()
    mock_cognito.admin_get_user.return_value = {
        "UserAttributes": [
            {"Name": "sub", "Value": "sub-123"},
            {"Name": "email", "Value": "test@example.com"},
        ],
    }
    mock_dynamo = MagicMock()
    mock_dynamo.query.return_value = {"Items": []}
    mock_boto_client.side_effect = lambda svc: mock_cognito if svc == "cognito-idp" else mock_dynamo
    event = _admin_event("/admin/users/test@example.com", method="DELETE")
    event["rawPath"] = "/admin/users/test@example.com"
    event["pathParameters"] = {"username": "test@example.com"}
    result = handler(event, None)
    assert result["statusCode"] == 200
    mock_cognito.admin_delete_user.assert_called_once_with(
        UserPoolId="us-east-1_abc123",
        Username="test@example.com",
    )
