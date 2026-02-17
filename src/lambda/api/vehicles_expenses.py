"""
Vehicles Expenses: per-user vehicle cost tracking.
Requires user to be in 'expenses' custom group. Data is private to each user.
"""
import logging
import os
import uuid

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))


def _pk(user_id):
    return f"USER#{user_id}"


def _sk(vehicle_id):
    return f"VEHICLE#{vehicle_id}"


def _fuel_sk(vehicle_id, fillup_id):
    return f"VEHICLE#{vehicle_id}#FUEL#{fillup_id}"


def _dynamo_item_to_dict(item):
    """Convert DynamoDB item to plain dict."""
    out = {}
    for k, v in item.items():
        if "S" in v:
            out[k] = v["S"]
        elif "N" in v:
            n = v["N"]
            out[k] = int(n) if "." not in n else float(n)
        elif "L" in v:
            out[k] = [x.get("S", x.get("N", "")) for x in v["L"]]
        elif "BOOL" in v:
            out[k] = v["BOOL"]
    return out


def _normalize_fuel_entry(e):
    """Ensure fuel entry has camelCase keys for API compatibility (handles legacy fuel_price)."""
    if "fuelPrice" not in e and "fuel_price" in e:
        e["fuelPrice"] = e["fuel_price"]
    return e


def list_vehicles(user_id):
    """List all vehicles for a user."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": _pk(user_id)},
                ":sk": {"S": "VEHICLE#"},
            },
        )
        items = resp.get("Items", [])
        vehicles = []
        for item in items:
            sk = item.get("SK", {}).get("S", "")
            if "#FUEL#" in sk:
                continue  # Skip fuel entries; only return actual vehicle records
            v = _dynamo_item_to_dict(item)
            v["id"] = sk.replace("VEHICLE#", "")
            vehicles.append(v)
        return vehicles
    except Exception as e:
        logger.warning("list_vehicles failed: %s", e)
        return []


def get_vehicle(user_id, vehicle_id):
    """Get a single vehicle by id."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return None
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _sk(vehicle_id)}},
        )
        if "Item" not in resp:
            return None
        v = _dynamo_item_to_dict(resp["Item"])
        v["id"] = vehicle_id
        return v
    except Exception as e:
        logger.warning("get_vehicle failed: %s", e)
        return None


def create_vehicle(user_id, data):
    """Create a new vehicle. Returns the created vehicle or None."""
    if not TABLE_NAME or not user_id:
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        vehicle_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        item = _build_item(data, now, now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _sk(vehicle_id)},
                **item,
            },
        )
        v = {k: data.get(k) for k in ["name"] if data.get(k) is not None}
        v["id"] = vehicle_id
        v["createdAt"] = now
        v["updatedAt"] = now
        return v
    except Exception as e:
        logger.warning("create_vehicle failed: %s", e)
        return None


def update_vehicle(user_id, vehicle_id, data):
    """Update an existing vehicle. Returns updated vehicle or None."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return None
    existing = get_vehicle(user_id, vehicle_id)
    if not existing:
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        now = datetime.utcnow().isoformat() + "Z"
        merged = {**existing, **data, "updatedAt": now}
        item = _build_item(merged, existing.get("createdAt", now), now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _sk(vehicle_id)},
                **item,
            },
        )
        merged["id"] = vehicle_id
        return merged
    except Exception as e:
        logger.warning("update_vehicle failed: %s", e)
        return None


def delete_vehicle(user_id, vehicle_id):
    """Delete a vehicle and all its fuel entries."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return False
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        # Delete all fuel entries first
        fuel_items = list_fuel_entries(user_id, vehicle_id)
        for f in fuel_items:
            dynamodb.delete_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _fuel_sk(vehicle_id, f["id"])}},
            )
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _sk(vehicle_id)}},
        )
        return True
    except Exception as e:
        logger.warning("delete_vehicle failed: %s", e)
        return False


# ------------------------------------------------------------------------------
# Fuel entry CRUD
# ------------------------------------------------------------------------------


def list_fuel_entries(user_id, vehicle_id):
    """List all fuel entries for a vehicle. Returns list sorted by date desc (newest first)."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        prefix = _fuel_sk(vehicle_id, "")
        resp = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": _pk(user_id)},
                ":sk": {"S": prefix},
            },
        )
        items = resp.get("Items", [])
        entries = []
        for item in items:
            sk = item.get("SK", {}).get("S", "")
            fillup_id = sk.replace(prefix, "") if sk.startswith(prefix) else sk.replace(f"VEHICLE#{vehicle_id}#FUEL#", "")
            e = _normalize_fuel_entry(_dynamo_item_to_dict(item))
            e["id"] = fillup_id
            entries.append(e)
        entries.sort(key=lambda x: x.get("date", ""), reverse=True)
        return entries
    except Exception as e:
        logger.warning("list_fuel_entries failed: %s", e)
        return []


def get_fuel_entry(user_id, vehicle_id, fillup_id):
    """Get a single fuel entry."""
    if not TABLE_NAME or not user_id or not vehicle_id or not fillup_id:
        return None
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _fuel_sk(vehicle_id, fillup_id)}},
        )
        if "Item" not in resp:
            return None
        e = _normalize_fuel_entry(_dynamo_item_to_dict(resp["Item"]))
        e["id"] = fillup_id
        return e
    except Exception as e:
        logger.warning("get_fuel_entry failed: %s", e)
        return None


def create_fuel_entry(user_id, vehicle_id, data):
    """Create a fuel entry. Returns created entry or None."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return None
    if not get_vehicle(user_id, vehicle_id):
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        fillup_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        item = _build_fuel_item(data, now, now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _fuel_sk(vehicle_id, fillup_id)},
                **item,
            },
        )
        e = {k: data.get(k) for k in ["date", "fuelPrice", "fuelLitres", "odometerKm"] if data.get(k) is not None}
        e["id"] = fillup_id
        e["createdAt"] = now
        e["updatedAt"] = now
        return e
    except Exception as ex:
        logger.warning("create_fuel_entry failed: %s", ex)
        return None


def update_fuel_entry(user_id, vehicle_id, fillup_id, data):
    """Update a fuel entry. Returns updated entry or None."""
    if not TABLE_NAME or not user_id or not vehicle_id or not fillup_id:
        return None
    existing = get_fuel_entry(user_id, vehicle_id, fillup_id)
    if not existing:
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        now = datetime.utcnow().isoformat() + "Z"
        merged = {**existing, **data, "updatedAt": now}
        item = _build_fuel_item(merged, existing.get("createdAt", now), now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _fuel_sk(vehicle_id, fillup_id)},
                **item,
            },
        )
        merged["id"] = fillup_id
        return merged
    except Exception as e:
        logger.warning("update_fuel_entry failed: %s", e)
        return None


def delete_fuel_entry(user_id, vehicle_id, fillup_id):
    """Delete a fuel entry."""
    if not TABLE_NAME or not user_id or not vehicle_id or not fillup_id:
        return False
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _fuel_sk(vehicle_id, fillup_id)}},
        )
        return True
    except Exception as e:
        logger.warning("delete_fuel_entry failed: %s", e)
        return False


def import_fuel_entries(user_id, payload):
    """
    Import fuel entries from Excel data.
    payload: { "imports": [ { "vehicleName": "My Car", "entries": [ { "date", "fuelPrice", "fuelLitres", "odometerKm" } ] } ] }
    Creates vehicles by name if they don't exist. Returns { created: int, errors: [] }.
    """
    if not TABLE_NAME or not user_id:
        return {"created": 0, "errors": ["TABLE_NAME or user_id missing"]}
    imports = payload.get("imports", [])
    if not isinstance(imports, list):
        return {"created": 0, "errors": ["imports must be an array"]}
    created = 0
    errors = []
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        vehicles_by_name = {v["name"]: v["id"] for v in list_vehicles(user_id) if v.get("name")}
        for imp in imports:
            vehicle_name = (imp.get("vehicleName") or "").strip()
            entries = imp.get("entries") or []
            if not vehicle_name:
                errors.append("Missing vehicleName in import")
                continue
            if not isinstance(entries, list):
                errors.append(f"Invalid entries for {vehicle_name}")
                continue
            vehicle_id = vehicles_by_name.get(vehicle_name)
            if not vehicle_id:
                new_vehicle = create_vehicle(user_id, {"name": vehicle_name})
                if new_vehicle:
                    vehicle_id = new_vehicle["id"]
                    vehicles_by_name[vehicle_name] = vehicle_id
                else:
                    errors.append(f"Failed to create vehicle {vehicle_name}")
                    continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                date_val = entry.get("date")
                fuel_price = entry.get("fuelPrice")
                fuel_litres = entry.get("fuelLitres")
                odometer = entry.get("odometerKm")
                if date_val is None and fuel_price is None and fuel_litres is None and odometer is None:
                    continue
                if isinstance(date_val, (int, float)) and date_val > 0:
                    try:
                        from datetime import datetime as dt, timedelta
                        excel_epoch = dt(1899, 12, 30)
                        date_val = (excel_epoch + timedelta(days=float(date_val))).strftime("%Y-%m-%d")
                    except Exception:
                        date_val = str(date_val)[:10]
                elif date_val is not None:
                    date_val = str(date_val)[:10]
                try:
                    fuel_price = float(fuel_price) if fuel_price is not None else 0
                    fuel_litres = float(fuel_litres) if fuel_litres is not None else 0
                    odometer = float(odometer) if odometer is not None else 0
                except (TypeError, ValueError):
                    errors.append(f"Invalid numbers in entry for {vehicle_name}: {entry}")
                    continue
                result = create_fuel_entry(user_id, vehicle_id, {
                    "date": date_val or "",
                    "fuelPrice": fuel_price,
                    "fuelLitres": fuel_litres,
                    "odometerKm": odometer,
                })
                if result:
                    created += 1
                else:
                    errors.append(f"Failed to create entry for {vehicle_name}: {entry}")
    except Exception as e:
        logger.exception("import_fuel_entries failed: %s", e)
        errors.append(str(e))
    return {"created": created, "errors": errors}


def _build_item(data, created_at, updated_at):
    """Build DynamoDB item from vehicle data. Extend fields as needed for your refdoc."""
    item = {
        "createdAt": {"S": created_at if isinstance(created_at, str) else ""},
        "updatedAt": {"S": updated_at if isinstance(updated_at, str) else ""},
    }
    for key in ["name"]:
        val = data.get(key)
        if val is not None:
            if isinstance(val, (int, float)):
                item[key] = {"N": str(val)}
            else:
                item[key] = {"S": str(val)}
    return item


def _build_fuel_item(data, created_at, updated_at):
    """Build DynamoDB item for fuel entry."""
    item = {
        "createdAt": {"S": created_at if isinstance(created_at, str) else ""},
        "updatedAt": {"S": updated_at if isinstance(updated_at, str) else ""},
    }
    for key in ["date", "fuelPrice", "fuelLitres", "odometerKm"]:
        val = data.get(key)
        if val is not None:
            if isinstance(val, (int, float)):
                item[key] = {"N": str(val)}
            else:
                item[key] = {"S": str(val)}
    return item
