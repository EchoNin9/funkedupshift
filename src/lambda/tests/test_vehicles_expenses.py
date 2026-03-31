"""Unit tests for vehicles expenses handlers."""
import json
from unittest.mock import patch

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


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.list_maintenance_entries", return_value=[
    {"id": "m1", "date": "2026-03-01", "price": 120.0, "mileage": 123500, "description": "Oil change"}
])
def test_list_maintenance_entries_user_in_expenses(mock_list, mock_groups):
    """GET /vehicles-expenses/{vehicleId}/maintenance returns entries."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses/v1/maintenance")
    event["pathParameters"] = {"vehicleId": "v1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert len(data["entries"]) == 1
    assert data["entries"][0]["id"] == "m1"


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.create_maintenance_entry", return_value={
    "id": "m1",
    "date": "2026-03-01",
    "price": 120.0,
    "mileage": 123500,
    "description": "Oil change",
    "vendor": "QuickLube",
    "tags": ["oil"],
    "attachments": [{"key": "k1", "filename": "receipt.pdf"}],
})
def test_create_maintenance_entry_success(mock_create, mock_groups):
    """POST /vehicles-expenses/{vehicleId}/maintenance creates a maintenance entry."""
    from api.handler import handler
    event = _expenses_user_event(
        "/vehicles-expenses/v1/maintenance",
        method="POST",
        body={
            "date": "2026-03-01",
            "price": 120,
            "mileage": 123500,
            "description": "Oil change",
            "vendor": "QuickLube",
            "tags": ["oil"],
            "attachments": [{"key": "k1", "filename": "receipt.pdf"}],
        },
    )
    event["pathParameters"] = {"vehicleId": "v1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 201
    data = json.loads(resp["body"])
    assert data["id"] == "m1"
    assert data["price"] == 120.0


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.update_maintenance_entry", return_value=None)
def test_update_maintenance_entry_not_found(mock_update, mock_groups):
    """PUT /vehicles-expenses/{vehicleId}/maintenance/{maintenanceId} returns 404 if missing."""
    from api.handler import handler
    event = _expenses_user_event(
        "/vehicles-expenses/v1/maintenance/missing",
        method="PUT",
        body={"date": "2026-03-01", "price": 10, "mileage": 1},
    )
    event["pathParameters"] = {"vehicleId": "v1", "maintenanceId": "missing"}
    resp = handler(event, None)
    assert resp["statusCode"] == 404


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.get_maintenance_attachment_upload", return_value={
    "uploadUrl": "https://example.com/upload",
    "key": "vehicle-expenses/user/v1/maintenance/file.pdf",
    "filename": "file.pdf",
    "contentType": "application/pdf",
})
def test_maintenance_upload_url_response_shape(mock_upload, mock_groups):
    """POST /vehicles-expenses/{vehicleId}/maintenance/upload returns upload metadata."""
    from api.handler import handler
    event = _expenses_user_event(
        "/vehicles-expenses/v1/maintenance/upload",
        method="POST",
        body={"filename": "file.pdf", "contentType": "application/pdf"},
    )
    event["pathParameters"] = {"vehicleId": "v1"}
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert set(["uploadUrl", "key", "filename", "contentType"]).issubset(set(data.keys()))


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.list_maintenance_tags", return_value=["oil", "tires"])
def test_list_maintenance_tags_endpoint(mock_tags, mock_groups):
    """GET /vehicles-expenses/maintenance-tags returns per-user tags."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses/maintenance-tags")
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert data["tags"] == ["oil", "tires"]


@patch("api.handler._getUserCustomGroups", return_value=["expenses"])
@patch("api.vehicles_expenses.list_maintenance_vendors", return_value=["QuickLube", "TireTown"])
def test_list_maintenance_vendors_endpoint(mock_vendors, mock_groups):
    """GET /vehicles-expenses/maintenance-vendors returns per-user vendors."""
    from api.handler import handler
    event = _expenses_user_event("/vehicles-expenses/maintenance-vendors")
    resp = handler(event, None)
    assert resp["statusCode"] == 200
    data = json.loads(resp["body"])
    assert data["vendors"] == ["QuickLube", "TireTown"]


def test_list_maintenance_tags_dedupes_and_filters():
    """vehicles_expenses.list_maintenance_tags dedupes and supports query filter."""
    from api import vehicles_expenses

    class FakeDynamo:
        def get_item(self, **kwargs):
            return {
                "Item": {
                    "tags": {
                        "L": [
                            {"S": "Oil"},
                            {"S": "oil"},
                            {"S": "Tires"},
                            {"S": "  "},
                            {"S": "Brakes"},
                        ]
                    }
                }
            }

    with patch.object(vehicles_expenses, "TABLE_NAME", "test-table"), patch("boto3.client", return_value=FakeDynamo()):
        all_tags = vehicles_expenses.list_maintenance_tags("user-1")
        assert all_tags == ["Brakes", "Oil", "Tires"]
        filtered = vehicles_expenses.list_maintenance_tags("user-1", "oi")
        assert filtered == ["Oil"]


def test_list_maintenance_vendors_dedupes_and_filters():
    """vehicles_expenses.list_maintenance_vendors dedupes and supports query filter."""
    from api import vehicles_expenses

    class FakeDynamo:
        def get_item(self, **kwargs):
            return {
                "Item": {
                    "vendors": {
                        "L": [
                            {"S": "QuickLube"},
                            {"S": "quicklube"},
                            {"S": "TireTown"},
                            {"S": "  "},
                            {"S": "Dealer"},
                        ]
                    }
                }
            }

    with patch.object(vehicles_expenses, "TABLE_NAME", "test-table"), patch("boto3.client", return_value=FakeDynamo()):
        all_vendors = vehicles_expenses.list_maintenance_vendors("user-1")
        assert all_vendors == ["Dealer", "QuickLube", "TireTown"]
        filtered = vehicles_expenses.list_maintenance_vendors("user-1", "quick")
        assert filtered == ["QuickLube"]


def test_list_vehicles_excludes_maintenance_and_fuel_entries():
    """vehicles_expenses.list_vehicles returns only true vehicle records."""
    from api import vehicles_expenses

    class FakeDynamo:
        def query(self, **kwargs):
            return {
                "Items": [
                    {
                        "PK": {"S": "USER#u1"},
                        "SK": {"S": "VEHICLE#v1"},
                        "name": {"S": "G70"},
                    },
                    {
                        "PK": {"S": "USER#u1"},
                        "SK": {"S": "VEHICLE#v1#FUEL#f1"},
                        "date": {"S": "2026-03-01"},
                    },
                    {
                        "PK": {"S": "USER#u1"},
                        "SK": {"S": "VEHICLE#v1#MAINT#m1"},
                        "date": {"S": "2026-03-02"},
                    },
                ]
            }

    with patch.object(vehicles_expenses, "TABLE_NAME", "test-table"), patch("boto3.client", return_value=FakeDynamo()):
        vehicles = vehicles_expenses.list_vehicles("u1")
        assert len(vehicles) == 1
        assert vehicles[0]["id"] == "v1"
        assert vehicles[0]["name"] == "G70"
