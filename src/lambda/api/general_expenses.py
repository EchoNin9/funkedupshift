"""
General expenses: per-user sections and expense line items.
Requires 'expenses' custom group. Private to each user.
"""
import logging
import os
import re
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")
AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _pk(user_id):
    return f"USER#{user_id}"


def _section_sk(section_id):
    return f"GENEXP#{section_id}"


def _entry_sk(section_id, entry_id):
    return f"GENEXP#{section_id}#ITEM#{entry_id}"


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
    return {k: _dynamo_value_to_python(v) for k, v in item.items()}


def _normalize_attachments(raw_list):
    if not isinstance(raw_list, list):
        return []
    normalized = []
    for raw in raw_list:
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
    return normalized


def _normalize_entry(entry):
    if not isinstance(entry.get("attachments"), list):
        entry["attachments"] = []
    if "reimbursed" not in entry:
        entry["reimbursed"] = False
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


def _build_section_item(data, created_at, updated_at):
    item = {
        "createdAt": {"S": created_at if isinstance(created_at, str) else ""},
        "updatedAt": {"S": updated_at if isinstance(updated_at, str) else ""},
    }
    name = data.get("name")
    if name is not None:
        item["name"] = {"S": str(name)}
    return item


def _build_entry_item(data, created_at, updated_at):
    item = {
        "createdAt": {"S": created_at if isinstance(created_at, str) else ""},
        "updatedAt": {"S": updated_at if isinstance(updated_at, str) else ""},
    }
    for key in ["date", "vendor", "description"]:
        val = data.get(key)
        if val is None:
            continue
        item[key] = {"S": str(val)}
    price = data.get("price")
    if price is not None:
        try:
            item["price"] = {"N": str(float(price))}
        except (TypeError, ValueError):
            item["price"] = {"N": "0"}
    item["reimbursed"] = {"BOOL": bool(data.get("reimbursed"))}
    normalized = _normalize_attachments(data.get("attachments") or [])
    item["attachments"] = _python_to_dynamo_value(normalized)
    return item


def list_sections(user_id):
    if not TABLE_NAME or not user_id:
        return []
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            FilterExpression="NOT contains(SK, :item)",
            ExpressionAttributeValues={
                ":pk": {"S": _pk(user_id)},
                ":sk": {"S": "GENEXP#"},
                ":item": {"S": "#ITEM#"},
            },
        )
        sections = []
        for item in resp.get("Items", []):
            d = _dynamo_item_to_dict(item)
            sk = item.get("SK", {}).get("S", "")
            if "#ITEM#" in sk:
                continue
            sid = sk.replace("GENEXP#", "", 1) if sk.startswith("GENEXP#") else sk
            d["id"] = sid
            sections.append(d)
        sections.sort(key=lambda x: (x.get("name") or "").lower())
        return sections
    except Exception as e:
        logger.warning("list_sections failed: %s", e)
        return []


def get_section(user_id, section_id):
    if not TABLE_NAME or not user_id or not section_id:
        return None
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _section_sk(section_id)}},
        )
        if "Item" not in resp:
            return None
        sk = resp["Item"].get("SK", {}).get("S", "")
        if "#ITEM#" in sk:
            return None
        d = _dynamo_item_to_dict(resp["Item"])
        d["id"] = section_id
        return d
    except Exception as e:
        logger.warning("get_section failed: %s", e)
        return None


def create_section(user_id, data):
    if not TABLE_NAME or not user_id:
        return None
    name = str(data.get("name") or "").strip()
    if not name:
        return None
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        section_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        item = _build_section_item({"name": name}, now, now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _section_sk(section_id)},
                **item,
            },
        )
        return {"id": section_id, "name": name, "createdAt": now, "updatedAt": now}
    except Exception as e:
        logger.warning("create_section failed: %s", e)
        return None


def update_section(user_id, section_id, data):
    if not TABLE_NAME or not user_id or not section_id:
        return None
    existing = get_section(user_id, section_id)
    if not existing:
        return None
    if "name" in data:
        new_name = str(data.get("name") or "").strip()
        if not new_name:
            return None
        existing["name"] = new_name
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        now = datetime.utcnow().isoformat() + "Z"
        merged = {**existing}
        item = _build_section_item(merged, existing.get("createdAt", now), now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _section_sk(section_id)},
                **item,
            },
        )
        merged["id"] = section_id
        merged["updatedAt"] = now
        return merged
    except Exception as e:
        logger.warning("update_section failed: %s", e)
        return None


def delete_section(user_id, section_id):
    if not TABLE_NAME or not user_id or not section_id:
        return False
    if not get_section(user_id, section_id):
        return False
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        for e in list_entries(user_id, section_id):
            eid = e.get("id")
            if eid:
                dynamodb.delete_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _entry_sk(section_id, eid)}},
                )
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _section_sk(section_id)}},
        )
        return True
    except Exception as e:
        logger.warning("delete_section failed: %s", e)
        return False


def list_entries(user_id, section_id):
    if not TABLE_NAME or not user_id or not section_id:
        return []
    if not get_section(user_id, section_id):
        return []
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        prefix = _entry_sk(section_id, "")
        resp = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues={
                ":pk": {"S": _pk(user_id)},
                ":sk": {"S": prefix},
            },
        )
        entries = []
        for item in resp.get("Items", []):
            sk = item.get("SK", {}).get("S", "")
            entry_id = sk.replace(prefix, "") if sk.startswith(prefix) else ""
            d = _normalize_entry(_dynamo_item_to_dict(item))
            d["id"] = entry_id
            entries.append(d)
        entries.sort(key=lambda x: x.get("date", ""), reverse=True)
        _add_attachment_urls(entries)
        return entries
    except Exception as e:
        logger.warning("list_entries failed: %s", e)
        return []


def get_entry(user_id, section_id, entry_id):
    if not TABLE_NAME or not user_id or not section_id or not entry_id:
        return None
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _entry_sk(section_id, entry_id)}},
        )
        if "Item" not in resp:
            return None
        d = _normalize_entry(_dynamo_item_to_dict(resp["Item"]))
        d["id"] = entry_id
        _add_attachment_urls([d])
        return d
    except Exception as e:
        logger.warning("get_entry failed: %s", e)
        return None


def _validate_entry_payload(data, partial=False):
    if not partial:
        date = str(data.get("date") or "").strip()
        if not date or not _DATE_RE.match(date):
            return "date must be YYYY-MM-DD"
        try:
            float(data.get("price"))
        except (TypeError, ValueError):
            return "price must be a number"
    else:
        if "date" in data:
            date = str(data.get("date") or "").strip()
            if date and not _DATE_RE.match(date):
                return "date must be YYYY-MM-DD"
        if "price" in data and data.get("price") is not None:
            try:
                float(data.get("price"))
            except (TypeError, ValueError):
                return "price must be a number"
    return None


def create_entry(user_id, section_id, data):
    if not TABLE_NAME or not user_id or not section_id:
        return None, "Missing section"
    if not get_section(user_id, section_id):
        return None, "Section not found"
    err = _validate_entry_payload(data, partial=False)
    if err:
        return None, err
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        entry_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat() + "Z"
        row = {
            "date": str(data.get("date") or "").strip(),
            "price": float(data.get("price")),
            "vendor": str(data.get("vendor") or "").strip(),
            "description": str(data.get("description") or "").strip(),
            "reimbursed": bool(data.get("reimbursed")),
            "attachments": _normalize_attachments(data.get("attachments") or []),
        }
        item = _build_entry_item(row, now, now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _entry_sk(section_id, entry_id)},
                **item,
            },
        )
        out = {**row, "id": entry_id, "createdAt": now, "updatedAt": now}
        out = _normalize_entry(out)
        _add_attachment_urls([out])
        return out, None
    except Exception as e:
        logger.warning("create_entry failed: %s", e)
        return None, str(e)


def update_entry(user_id, section_id, entry_id, data):
    if not TABLE_NAME or not user_id or not section_id or not entry_id:
        return None, "Missing ids"
    existing = get_entry(user_id, section_id, entry_id)
    if not existing:
        return None, "Entry not found"
    err = _validate_entry_payload(data, partial=True)
    if err:
        return None, err
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        now = datetime.utcnow().isoformat() + "Z"
        merged = {**existing, **data, "updatedAt": now}
        if "attachments" in data:
            merged["attachments"] = _normalize_attachments(data.get("attachments") or [])
        if "price" in merged and merged["price"] is not None:
            merged["price"] = float(merged["price"])
        merged["reimbursed"] = bool(merged.get("reimbursed"))
        item = _build_entry_item(merged, existing.get("createdAt", now), now)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": _pk(user_id)},
                "SK": {"S": _entry_sk(section_id, entry_id)},
                **item,
            },
        )
        merged["id"] = entry_id
        merged = _normalize_entry(merged)
        _add_attachment_urls([merged])
        return merged, None
    except Exception as e:
        logger.warning("update_entry failed: %s", e)
        return None, str(e)


def delete_entry(user_id, section_id, entry_id):
    if not TABLE_NAME or not user_id or not section_id or not entry_id:
        return False
    try:
        import boto3

        dynamodb = boto3.client("dynamodb", region_name=AWS_REGION)
        dynamodb.delete_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": _pk(user_id)}, "SK": {"S": _entry_sk(section_id, entry_id)}},
        )
        return True
    except Exception as e:
        logger.warning("delete_entry failed: %s", e)
        return False


def get_attachment_upload(user_id, section_id, filename, content_type):
    if not TABLE_NAME or not user_id or not section_id or not MEDIA_BUCKET:
        return None
    if not get_section(user_id, section_id):
        return None
    safe_name = (filename or "attachment").strip() or "attachment"
    safe_name = safe_name.replace("/", "_").replace("\\", "_")
    ext = ""
    if "." in safe_name:
        ext = "." + safe_name.rsplit(".", 1)[-1].lower()
    key = f"general-expenses/{user_id}/{section_id}/{uuid.uuid4()}{ext}"
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
        logger.warning("get_attachment_upload failed: %s", e)
        return None
