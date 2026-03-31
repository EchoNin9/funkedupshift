"""
Vehicles Expenses: per-user vehicle cost tracking.
Requires user to be in 'expenses' custom group. Data is private to each user.
"""
import logging
import os
import csv
import io
import re
import uuid
import zipfile
from datetime import datetime

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _pk(user_id):
    return f"USER#{user_id}"


def _sk(vehicle_id):
    return f"VEHICLE#{vehicle_id}"


def _fuel_sk(vehicle_id, fillup_id):
    return f"VEHICLE#{vehicle_id}#FUEL#{fillup_id}"


def _maint_sk(vehicle_id, maintenance_id):
    return f"VEHICLE#{vehicle_id}#MAINT#{maintenance_id}"


def _dynamo_value_to_python(value):
    if "S" in value:
        return value["S"]
    if "N" in value:
        n = value["N"]
        return int(n) if "." not in n else float(n)
    if "BOOL" in value:
        return value["BOOL"]
    if "L" in value:
        return [_dynamo_value_to_python(v) for v in value["L"]]
    if "M" in value:
        return {k: _dynamo_value_to_python(v) for k, v in value["M"].items()}
    if "NULL" in value:
        return None
    return None


def _python_to_dynamo_value(value):
    if value is None:
        return {"NULL": True}
    if isinstance(value, bool):
        return {"BOOL": value}
    if isinstance(value, (int, float)):
        return {"N": str(value)}
    if isinstance(value, list):
        return {"L": [_python_to_dynamo_value(v) for v in value]}
    if isinstance(value, dict):
        return {"M": {str(k): _python_to_dynamo_value(v) for k, v in value.items() if v is not None}}
    return {"S": str(value)}


def _dynamo_item_to_dict(item):
    """Convert DynamoDB item to plain dict."""
    return {k: _dynamo_value_to_python(v) for k, v in item.items()}


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
            if "#FUEL#" in sk or "#MAINT#" in sk:
                continue  # Skip expense entries; only return actual vehicle records
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
        # Delete all maintenance entries
        maintenance_items = list_maintenance_entries(user_id, vehicle_id)
        for m in maintenance_items:
            dynamodb.delete_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _maint_sk(vehicle_id, m["id"])}},
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


def _normalize_maintenance_entry(entry):
    if not isinstance(entry.get("tags"), list):
        entry["tags"] = []
    if not isinstance(entry.get("attachments"), list):
        entry["attachments"] = []
    return entry


def _add_attachment_urls(entries):
    if not entries or not MEDIA_BUCKET:
        return
    try:
        import boto3
        s3 = boto3.client("s3", region_name=AWS_REGION)
        for entry in entries:
            attachments = entry.get("attachments") or []
            if not isinstance(attachments, list):
                continue
            for attachment in attachments:
                if not isinstance(attachment, dict):
                    continue
                key = str(attachment.get("key") or "").strip()
                if not key:
                    continue
                attachment["url"] = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": MEDIA_BUCKET, "Key": key},
                    ExpiresIn=3600,
                )
    except Exception as e:
        logger.warning("_add_attachment_urls failed: %s", e)


def _normalize_maintenance_tags(tags):
    out = []
    seen = set()
    for raw in tags or []:
        t = str(raw).strip()
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def _normalize_maintenance_vendor(vendor):
    v = str(vendor or "").strip()
    return v


def list_maintenance_vendors(user_id, query=""):
    """List per-user maintenance vendors for autocomplete."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": "VEHICLE_MAINT_VENDORS#REGISTRY"}},
        )
        vendors = []
        if "Item" in resp and "vendors" in resp["Item"]:
            vendors = [v.get("S", "").strip() for v in resp["Item"]["vendors"].get("L", []) if v.get("S", "").strip()]
        deduped = []
        seen = set()
        for vendor in vendors:
            key = vendor.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(vendor)
        q = (query or "").strip().lower()
        if q:
            deduped = [v for v in deduped if q in v.lower()]
        return sorted(deduped, key=lambda v: v.lower())
    except Exception as e:
        logger.warning("list_maintenance_vendors failed: %s", e)
        return []


def _ensure_maintenance_vendor(user_id, vendor):
    normalized = _normalize_maintenance_vendor(vendor)
    if not normalized or not TABLE_NAME or not user_id:
        return
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        existing = list_maintenance_vendors(user_id, "")
        exists = any(v.lower() == normalized.lower() for v in existing)
        if exists:
            return
        combined = [*existing, normalized]
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": "VEHICLE_MAINT_VENDORS#REGISTRY"},
                "vendors": {"L": [{"S": v} for v in combined]},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
    except Exception as e:
        logger.warning("_ensure_maintenance_vendor failed: %s", e)


def list_maintenance_tags(user_id, query=""):
    """List per-user maintenance tags for autocomplete."""
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": "VEHICLE_MAINT_TAGS#REGISTRY"}},
        )
        tags = []
        if "Item" in resp and "tags" in resp["Item"]:
            tags = [v.get("S", "") for v in resp["Item"]["tags"].get("L", []) if v.get("S", "")]
        tags = _normalize_maintenance_tags(tags)
        q = (query or "").strip().lower()
        if q:
            tags = [t for t in tags if q in t.lower()]
        return sorted(tags, key=lambda t: t.lower())
    except Exception as e:
        logger.warning("list_maintenance_tags failed: %s", e)
        return []


def _ensure_maintenance_tags(user_id, tags):
    normalized = _normalize_maintenance_tags(tags)
    if not normalized or not TABLE_NAME or not user_id:
        return
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        existing = list_maintenance_tags(user_id, "")
        combined = _normalize_maintenance_tags([*existing, *normalized])
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": "VEHICLE_MAINT_TAGS#REGISTRY"},
                "tags": {"L": [{"S": t} for t in combined]},
                "createdAt": {"S": now},
                "updatedAt": {"S": now},
            },
        )
    except Exception as e:
        logger.warning("_ensure_maintenance_tags failed: %s", e)


def list_maintenance_entries(user_id, vehicle_id):
    """List all maintenance entries for a vehicle. Returns newest first."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        prefix = _maint_sk(vehicle_id, "")
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
            maintenance_id = sk.replace(prefix, "") if sk.startswith(prefix) else sk.replace(f"VEHICLE#{vehicle_id}#MAINT#", "")
            entry = _normalize_maintenance_entry(_dynamo_item_to_dict(item))
            entry["id"] = maintenance_id
            entries.append(entry)
        entries.sort(key=lambda x: x.get("date", ""), reverse=True)
        _add_attachment_urls(entries)
        return entries
    except Exception as e:
        logger.warning("list_maintenance_entries failed: %s", e)
        return []


def get_maintenance_entry(user_id, vehicle_id, maintenance_id):
    """Get one maintenance entry."""
    if not TABLE_NAME or not user_id or not vehicle_id or not maintenance_id:
        return None
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _maint_sk(vehicle_id, maintenance_id)}},
        )
        if "Item" not in resp:
            return None
        entry = _normalize_maintenance_entry(_dynamo_item_to_dict(resp["Item"]))
        entry["id"] = maintenance_id
        _add_attachment_urls([entry])
        return entry
    except Exception as e:
        logger.warning("get_maintenance_entry failed: %s", e)
        return None


def create_maintenance_entry(user_id, vehicle_id, data):
    """Create one maintenance entry."""
    if not TABLE_NAME or not user_id or not vehicle_id:
        return None
    if not get_vehicle(user_id, vehicle_id):
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        maintenance_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        item = _build_maintenance_item(data, now, now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _maint_sk(vehicle_id, maintenance_id)},
                **item,
            },
        )
        tags = _normalize_maintenance_tags(data.get("tags") or [])
        vendor = _normalize_maintenance_vendor(data.get("vendor"))
        _ensure_maintenance_tags(user_id, tags)
        _ensure_maintenance_vendor(user_id, vendor)
        entry = {
            k: data.get(k)
            for k in ["date", "price", "mileage", "description", "vendor", "attachments"]
            if data.get(k) is not None
        }
        entry["tags"] = tags
        entry["vendor"] = vendor
        entry["attachments"] = data.get("attachments") or []
        entry["id"] = maintenance_id
        entry["createdAt"] = now
        entry["updatedAt"] = now
        entry = _normalize_maintenance_entry(entry)
        _add_attachment_urls([entry])
        return entry
    except Exception as ex:
        logger.warning("create_maintenance_entry failed: %s", ex)
        return None


def update_maintenance_entry(user_id, vehicle_id, maintenance_id, data):
    """Update one maintenance entry."""
    if not TABLE_NAME or not user_id or not vehicle_id or not maintenance_id:
        return None
    existing = get_maintenance_entry(user_id, vehicle_id, maintenance_id)
    if not existing:
        return None
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        now = datetime.utcnow().isoformat() + "Z"
        merged = {**existing, **data, "updatedAt": now}
        merged["tags"] = _normalize_maintenance_tags(merged.get("tags") or [])
        merged["vendor"] = _normalize_maintenance_vendor(merged.get("vendor"))
        merged["attachments"] = merged.get("attachments") or []
        item = _build_maintenance_item(merged, existing.get("createdAt", now), now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _maint_sk(vehicle_id, maintenance_id)},
                **item,
            },
        )
        _ensure_maintenance_tags(user_id, merged["tags"])
        _ensure_maintenance_vendor(user_id, merged.get("vendor"))
        merged["id"] = maintenance_id
        merged = _normalize_maintenance_entry(merged)
        _add_attachment_urls([merged])
        return merged
    except Exception as e:
        logger.warning("update_maintenance_entry failed: %s", e)
        return None


def delete_maintenance_entry(user_id, vehicle_id, maintenance_id):
    """Delete one maintenance entry."""
    if not TABLE_NAME or not user_id or not vehicle_id or not maintenance_id:
        return False
    try:
        import boto3
        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _maint_sk(vehicle_id, maintenance_id)}},
        )
        return True
    except Exception as e:
        logger.warning("delete_maintenance_entry failed: %s", e)
        return False


def get_maintenance_attachment_upload(user_id, vehicle_id, filename, content_type):
    """Return presigned PUT URL for maintenance attachment uploads."""
    if not TABLE_NAME or not user_id or not vehicle_id or not MEDIA_BUCKET:
        return None
    if not get_vehicle(user_id, vehicle_id):
        return None
    safe_name = (filename or "attachment").strip() or "attachment"
    if "/" in safe_name or "\\" in safe_name:
        safe_name = safe_name.replace("/", "_").replace("\\", "_")
    ext = ""
    if "." in safe_name:
        ext = "." + safe_name.rsplit(".", 1)[-1].lower()
    key = f"vehicle-expenses/{user_id}/{vehicle_id}/maintenance/{uuid.uuid4()}{ext}"
    try:
        import boto3
        s3 = boto3.client("s3", region_name=AWS_REGION)
        params = {"Bucket": MEDIA_BUCKET, "Key": key}
        if content_type:
            params["ContentType"] = content_type
        upload_url = s3.generate_presigned_url("put_object", Params=params, ExpiresIn=3600)
        return {
            "uploadUrl": upload_url,
            "key": key,
            "filename": safe_name,
            "contentType": content_type or "application/octet-stream",
        }
    except Exception as e:
        logger.warning("get_maintenance_attachment_upload failed: %s", e)
        return None


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


def _valid_date_or_empty(date_value):
    s = str(date_value or "").strip()
    if not s:
        return ""
    if not _DATE_RE.match(s):
        return ""
    return s


def _filter_entries_by_date(entries, start_date="", end_date=""):
    start = _valid_date_or_empty(start_date)
    end = _valid_date_or_empty(end_date)
    out = []
    for entry in entries or []:
        date_value = _valid_date_or_empty(entry.get("date"))
        if start and date_value and date_value < start:
            continue
        if end and date_value and date_value > end:
            continue
        out.append(entry)
    return out


def _format_number(value, decimals=2):
    try:
        return f"{float(value):.{decimals}f}"
    except Exception:
        return ""


def _render_csv_bytes(headers, rows):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return buf.getvalue().encode("utf-8")


def _fuel_rows(entries):
    rows = []
    for e in entries or []:
        rows.append(
            [
                e.get("date", ""),
                _format_number(e.get("fuelPrice", e.get("fuel_price", "")), 2),
                _format_number(e.get("fuelLitres", ""), 3),
                _format_number(e.get("odometerKm", ""), 0),
            ]
        )
    return rows


def _maintenance_rows(entries):
    rows = []
    for e in entries or []:
        rows.append(
            [
                e.get("date", ""),
                _format_number(e.get("price", ""), 2),
                _format_number(e.get("mileage", ""), 0),
                e.get("vendor", "") or "",
                (e.get("description", "") or "").replace("\n", " ").replace("\r", " "),
                ", ".join([str(t) for t in (e.get("tags") or []) if str(t).strip()]),
                len(e.get("attachments") or []),
            ]
        )
    return rows


def _escape_pdf_text(text):
    return str(text or "").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _simple_pdf_bytes(title, lines):
    # Minimal single-page PDF writer using built-in Helvetica font.
    max_lines = 48
    usable_lines = [title, ""] + [str(line) for line in (lines or [])]
    usable_lines = usable_lines[:max_lines]
    commands = ["BT", "/F1 10 Tf", "50 790 Td"]
    for idx, line in enumerate(usable_lines):
        if idx == 0:
            commands.append(f"({_escape_pdf_text(line)}) Tj")
        else:
            commands.append("0 -14 Td")
            commands.append(f"({_escape_pdf_text(line)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("utf-8")

    objs = []
    objs.append(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n")
    objs.append(b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n")
    objs.append(
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n"
    )
    objs.append(b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n")
    objs.append(f"5 0 obj << /Length {len(stream)} >> stream\n".encode("utf-8") + stream + b"\nendstream endobj\n")

    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objs:
        offsets.append(pdf.tell())
        pdf.write(obj)
    xref_pos = pdf.tell()
    count = len(offsets)
    pdf.write(f"xref\n0 {count}\n".encode("utf-8"))
    pdf.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.write(f"{off:010d} 00000 n \n".encode("utf-8"))
    pdf.write(
        f"trailer << /Size {count} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF".encode("utf-8")
    )
    return pdf.getvalue()


def _safe_filename_part(name):
    raw = str(name or "").strip() or "file"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")
    return safe or "file"


def _upload_export_artifact(user_id, vehicle_id, file_name, content_type, payload):
    if not MEDIA_BUCKET:
        raise ValueError("MEDIA_BUCKET is not configured")
    import boto3
    s3 = boto3.client("s3", region_name=AWS_REGION)
    key = f"vehicle-expenses/{user_id}/{vehicle_id}/exports/{uuid.uuid4()}-{_safe_filename_part(file_name)}"
    s3.put_object(
        Bucket=MEDIA_BUCKET,
        Key=key,
        Body=payload,
        ContentType=content_type,
    )
    download_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": MEDIA_BUCKET, "Key": key},
        ExpiresIn=3600,
    )
    return {
        "filename": file_name,
        "contentType": content_type,
        "key": key,
        "downloadUrl": download_url,
        "expiresIn": 3600,
    }


def _build_maintenance_attachment_zip_entries(entries):
    out = []
    used_paths = set()
    for entry in entries or []:
        entry_id = _safe_filename_part(entry.get("id") or "entry")
        entry_date = _safe_filename_part(entry.get("date") or "unknown-date")
        for idx, attachment in enumerate(entry.get("attachments") or []):
            if not isinstance(attachment, dict):
                continue
            key = str(attachment.get("key") or "").strip()
            if not key:
                continue
            base_name = _safe_filename_part(attachment.get("filename") or key.rsplit("/", 1)[-1] or f"attachment-{idx + 1}")
            rel_path = f"attachments/{entry_date}_{entry_id}/{base_name}"
            dedupe = 1
            while rel_path in used_paths:
                dedupe += 1
                rel_path = f"attachments/{entry_date}_{entry_id}/{dedupe}_{base_name}"
            used_paths.add(rel_path)
            out.append((rel_path, key))
    return out


def _build_zip_payload(user_id, fuel_entries, maintenance_entries, include_fuel_csv, include_maintenance_csv):
    import boto3
    s3 = boto3.client("s3", region_name=AWS_REGION)
    out = io.BytesIO()
    with zipfile.ZipFile(out, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        if include_fuel_csv:
            zf.writestr(
                "fuel.csv",
                _render_csv_bytes(["Date", "Fuel Price", "Fuel Litres", "Odometer (km)"], _fuel_rows(fuel_entries)),
            )
        if include_maintenance_csv:
            zf.writestr(
                "maintenance.csv",
                _render_csv_bytes(
                    ["Date", "Price", "Mileage (km)", "Vendor", "Description", "Tags", "Attachment Count"],
                    _maintenance_rows(maintenance_entries),
                ),
            )
        attachment_paths = _build_maintenance_attachment_zip_entries(maintenance_entries)
        errors = []
        for rel_path, key in attachment_paths:
            try:
                obj = s3.get_object(Bucket=MEDIA_BUCKET, Key=key)
                body = obj.get("Body")
                data = body.read() if body else b""
                zf.writestr(rel_path, data)
            except Exception as ex:
                errors.append(f"{key}: {ex}")
        if errors:
            zf.writestr("attachments_errors.txt", "\n".join(errors).encode("utf-8"))
    return out.getvalue()


def export_fuel_entries(user_id, vehicle_id, export_format, start_date="", end_date=""):
    vehicle = get_vehicle(user_id, vehicle_id)
    if not vehicle:
        return None
    fmt = (export_format or "").strip().lower()
    if fmt not in ("csv", "pdf"):
        raise ValueError("format must be csv or pdf")
    entries = _filter_entries_by_date(list_fuel_entries(user_id, vehicle_id), start_date, end_date)
    vehicle_name = _safe_filename_part(vehicle.get("name") or "vehicle")
    if fmt == "csv":
        payload = _render_csv_bytes(["Date", "Fuel Price", "Fuel Litres", "Odometer (km)"], _fuel_rows(entries))
        return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-fuel.csv", "text/csv", payload)
    lines = [
        f"Vehicle: {vehicle.get('name') or 'Vehicle'}",
        f"Date range: {start_date or 'all'} to {end_date or 'all'}",
        f"Rows: {len(entries)}",
        "",
    ]
    for row in _fuel_rows(entries):
        lines.append(f"{row[0]} | ${row[1]} | {row[2]}L | {row[3]}km")
    payload = _simple_pdf_bytes(f"Fuel Export - {vehicle.get('name') or 'Vehicle'}", lines)
    return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-fuel.pdf", "application/pdf", payload)


def export_maintenance_entries(user_id, vehicle_id, export_format, start_date="", end_date=""):
    vehicle = get_vehicle(user_id, vehicle_id)
    if not vehicle:
        return None
    fmt = (export_format or "").strip().lower()
    if fmt not in ("csv", "pdf", "zip"):
        raise ValueError("format must be csv, pdf, or zip")
    entries = _filter_entries_by_date(list_maintenance_entries(user_id, vehicle_id), start_date, end_date)
    vehicle_name = _safe_filename_part(vehicle.get("name") or "vehicle")
    if fmt == "csv":
        payload = _render_csv_bytes(
            ["Date", "Price", "Mileage (km)", "Vendor", "Description", "Tags", "Attachment Count"],
            _maintenance_rows(entries),
        )
        return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-maintenance.csv", "text/csv", payload)
    if fmt == "pdf":
        lines = [
            f"Vehicle: {vehicle.get('name') or 'Vehicle'}",
            f"Date range: {start_date or 'all'} to {end_date or 'all'}",
            f"Rows: {len(entries)}",
            "",
        ]
        for row in _maintenance_rows(entries):
            lines.append(f"{row[0]} | ${row[1]} | {row[2]}km | {row[3]} | {row[6]} files")
        payload = _simple_pdf_bytes(f"Maintenance Export - {vehicle.get('name') or 'Vehicle'}", lines)
        return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-maintenance.pdf", "application/pdf", payload)
    payload = _build_zip_payload(
        user_id=user_id,
        fuel_entries=[],
        maintenance_entries=entries,
        include_fuel_csv=False,
        include_maintenance_csv=True,
    )
    return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-maintenance.zip", "application/zip", payload)


def export_all_vehicle_expenses(user_id, vehicle_id):
    vehicle = get_vehicle(user_id, vehicle_id)
    if not vehicle:
        return None
    fuel_entries = list_fuel_entries(user_id, vehicle_id)
    maintenance_entries = list_maintenance_entries(user_id, vehicle_id)
    vehicle_name = _safe_filename_part(vehicle.get("name") or "vehicle")
    payload = _build_zip_payload(
        user_id=user_id,
        fuel_entries=fuel_entries,
        maintenance_entries=maintenance_entries,
        include_fuel_csv=True,
        include_maintenance_csv=True,
    )
    return _upload_export_artifact(user_id, vehicle_id, f"{vehicle_name}-all-expenses.zip", "application/zip", payload)


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


def _build_maintenance_item(data, created_at, updated_at):
    """Build DynamoDB item for maintenance entry."""
    item = {
        "createdAt": {"S": created_at if isinstance(created_at, str) else ""},
        "updatedAt": {"S": updated_at if isinstance(updated_at, str) else ""},
    }
    for key in ["date", "price", "mileage", "description", "vendor"]:
        val = data.get(key)
        if val is None:
            continue
        if isinstance(val, (int, float)):
            item[key] = {"N": str(val)}
        else:
            item[key] = {"S": str(val)}
    tags = _normalize_maintenance_tags(data.get("tags") or [])
    item["tags"] = {"L": [{"S": t} for t in tags]}
    attachments = data.get("attachments") or []
    if not isinstance(attachments, list):
        attachments = []
    normalized = []
    for raw in attachments:
        if not isinstance(raw, dict):
            continue
        key = str(raw.get("key") or "").strip()
        if not key:
            continue
        normalized.append(
            {
                "key": key,
                "filename": str(raw.get("filename") or "").strip(),
                "contentType": str(raw.get("contentType") or "").strip(),
                "size": raw.get("size"),
            }
        )
    item["attachments"] = _python_to_dynamo_value(normalized)
    return item
