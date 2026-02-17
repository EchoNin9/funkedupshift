"""Unit tests for vehicles expenses handlers."""
import json
from unittest.mock import patch

import pytest

# Minimal event with auth (expenses group)
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
                    "sub": "user-expenses-123",
                    "email": "expenses@example.com",
                    "cognito:groups": '["user"]',
                }
            }
        },
    }
    return event


def _admin_event(path, method="GET", body=None):
    event = _event(path, method, body)
    event["requestContext"] = {
        "http": {"method": method, "path": path},
        "authorizer": {
            "jwt": {
                "claims": {
                    "sub": "admin-123",
                    "email": "admin@example.com",
                    "cognito:groups": '["admin"]',
                }
            }
        },
    }
    return event


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.list_vehicles", return_value=[])
def test_list_vehicles_expenses_user_in_group(mock_list, mock_groups):
    """GET /vehicles-expenses as user in expenses group returns list."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses")
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert "vehicles" in data
    assert data["vehicles"] == []


@patch("api.handler._getUserCustomGroups", return_value=[])
def test_list_vehicles_expenses_user_not_in_group(mock_groups):
    """GET /vehicles-expenses without expenses group returns 403."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses")
    resp = handler(event, None)
    assert resp["statusCode"] == 403


@patch("api.handler._getUserCustomGroups", return_value=[])
@patch("api.vehicles_expenses.create_vehicle", return_value={"id": "v1", "name": "Car"})
def test_create_vehicle_admin_can_access(mock_create, mock_groups):
    """POST /vehicles-expenses as admin can create."""
    from api.handler import handler
    event = _admin_event("/vehicles-expenses", method="POST", body={"name": "Car"})
    resp = handler(event, None)
    assert resp["statusCode"] == 201
    data = json.loads(resp["body"])
    assert data["id"] == "v1"
    assert data["name"] == "Car"


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.list_fuel_entries", return_value=[
    {"id": "f1", "date": "2026-02-15", "fuelPrice": 65, "fuelLitres": 45.5, "odometerKm": 123456}
])
def test_list_fuel_entries_user_in_expenses(mock_list, mock_groups):
    """GET /vehicles-expenses/{vehicleId}/fuel as user in expenses group returns entries."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses/v1/fuel")
    event["pathParameters"] = {"vehicleId": "v1"}
    event["rawPath"] = "/vehicles-expenses/v1/fuel"
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert "entries" in data
    assert len(data["entries"]) == 1
    assert data["entries"][0]["fuelPrice"] == 65
