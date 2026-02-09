"""Unit tests for Squash doubles API handlers."""
import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(path, method="GET", body=None, sub="user-123", groups="user"):
    """Event with JWT authorizer."""
    return {
        "rawPath": path,
        "pathParameters": {},
        "queryStringParameters": {},
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


def _admin_event(path, method="GET", body=None):
    """Event with admin (SuperAdmin) JWT authorizer."""
    return _event(path, method, body, sub="admin-123", groups="admin")


def _manager_event(path, method="GET", body=None):
    """Event with manager JWT authorizer."""
    return _event(path, method, body, sub="manager-123", groups="manager")


def _user_event(path, method="GET", body=None):
    """Event with regular user JWT authorizer."""
    return _event(path, method, body, sub="user-123", groups="user")


def test_listSquashPlayers_requires_auth():
    """GET /squash/players without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/squash/players",
        "requestContext": {"http": {"method": "GET", "path": "/squash/players"}},
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_listSquashPlayers_denied_without_squash_access(mock_custom_groups):
    """GET /squash/players with user not in Squash group returns 403."""
    from api.handler import handler
    event = _user_event("/squash/players")
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_listSquashPlayers_admin_can_access(mock_custom_groups):
    """GET /squash/players as SuperAdmin can access (admin sees all)."""
    from api.handler import handler
    with patch("api.handler.TABLE_NAME", "fus-main"):
        with patch("boto3.client") as mock_boto:
            mock_dynamo = MagicMock()
            mock_dynamo.query.return_value = {"Items": []}
            mock_boto.return_value = mock_dynamo
            event = _admin_event("/squash/players")
            result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "players" in body


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
def test_listSquashPlayers_squash_group_can_access(mock_custom_groups):
    """GET /squash/players as user in Squash group can access."""
    from api.handler import handler
    with patch("api.handler.TABLE_NAME", "fus-main"):
        with patch("boto3.client") as mock_boto:
            mock_dynamo = MagicMock()
            mock_dynamo.query.return_value = {"Items": []}
            mock_boto.return_value = mock_dynamo
            event = _user_event("/squash/players")
            result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "players" in body


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
def test_createSquashPlayer_user_denied(mock_custom_groups):
    """POST /squash/players as user in Squash but not manager returns 403."""
    from api.handler import handler
    event = _user_event("/squash/players", method="POST", body={"name": "Alice"})
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_createSquashPlayer_manager_not_in_squash_denied(mock_custom_groups):
    """POST /squash/players as manager not in Squash returns 403."""
    from api.handler import handler
    event = _manager_event("/squash/players", method="POST", body={"name": "Alice"})
    result = handler(event, None)
    assert result["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSquashPlayer_manager_in_squash_succeeds(mock_boto, mock_custom_groups):
    """POST /squash/players as manager in Squash creates player."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto.return_value = mock_dynamo
    event = _manager_event("/squash/players", method="POST", body={"name": "Alice"})
    result = handler(event, None)
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert "id" in body
    assert "name" in body or body.get("name") == "Alice"
    mock_dynamo.put_item.assert_called()


@patch("api.handler._getUserCustomGroups", return_value=[])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSquashPlayer_admin_succeeds(mock_boto, mock_custom_groups):
    """POST /squash/players as SuperAdmin creates player."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto.return_value = mock_dynamo
    event = _admin_event("/squash/players", method="POST", body={"name": "Bob"})
    result = handler(event, None)
    assert result["statusCode"] == 201
    body = json.loads(result["body"])
    assert "id" in body


def test_createSquashPlayer_requires_name():
    """POST /squash/players without name returns 400."""
    from api.handler import handler
    with patch("api.handler._getUserCustomGroups", return_value=["Squash"]):
        with patch("api.handler.TABLE_NAME", "fus-main"):
            event = _manager_event("/squash/players", method="POST", body={})
            result = handler(event, None)
    assert result["statusCode"] == 400


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSquashMatch_validation_duplicate_players(mock_boto, mock_custom_groups):
    """POST /squash/matches with duplicate player returns 400."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto.return_value = mock_dynamo
    body = {
        "date": "2024-01-15",
        "teamAPlayer1Id": "p1",
        "teamAPlayer2Id": "p2",
        "teamBPlayer1Id": "p3",
        "teamBPlayer2Id": "p1",
        "winningTeam": "A",
        "teamAGames": 3,
        "teamBGames": 1,
    }
    event = _manager_event("/squash/matches", method="POST", body=body)
    result = handler(event, None)
    assert result["statusCode"] == 400
    body_resp = json.loads(result["body"])
    assert "error" in body_resp


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSquashMatch_validation_invalid_score(mock_boto, mock_custom_groups):
    """POST /squash/matches with invalid score (winner not 3) returns 400."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto.return_value = mock_dynamo
    body = {
        "date": "2024-01-15",
        "teamAPlayer1Id": "p1",
        "teamAPlayer2Id": "p2",
        "teamBPlayer1Id": "p3",
        "teamBPlayer2Id": "p4",
        "winningTeam": "A",
        "teamAGames": 2,
        "teamBGames": 1,
    }
    event = _manager_event("/squash/matches", method="POST", body=body)
    result = handler(event, None)
    assert result["statusCode"] == 400
    body_resp = json.loads(result["body"])
    assert "error" in body_resp


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_createSquashMatch_succeeds(mock_boto, mock_custom_groups):
    """POST /squash/matches with valid data creates match."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_boto.return_value = mock_dynamo
    body = {
        "date": "2024-01-15",
        "teamAPlayer1Id": "p1",
        "teamAPlayer2Id": "p2",
        "teamBPlayer1Id": "p3",
        "teamBPlayer2Id": "p4",
        "winningTeam": "A",
        "teamAGames": 3,
        "teamBGames": 1,
    }
    event = _manager_event("/squash/matches", method="POST", body=body)
    result = handler(event, None)
    assert result["statusCode"] == 201
    body_resp = json.loads(result["body"])
    assert "id" in body_resp
    assert body_resp.get("date") == "2024-01-15"
    assert mock_dynamo.put_item.call_count >= 5


@patch("api.handler._getUserCustomGroups", return_value=["Squash"])
@patch("api.handler.TABLE_NAME", "fus-main")
@patch("boto3.client")
def test_listSquashMatches_returns_matches(mock_boto, mock_custom_groups):
    """GET /squash/matches returns match list."""
    from api.handler import handler
    mock_dynamo = MagicMock()
    mock_dynamo.query.return_value = {"Items": []}
    mock_boto.return_value = mock_dynamo
    event = _admin_event("/squash/matches")
    result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert "matches" in body
