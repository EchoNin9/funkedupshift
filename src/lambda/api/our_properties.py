"""
Our Properties: list of our own sites (dashboard-style grid).
No HTTP checks, PageSpeed, or external APIs - just returns stored sites for display.
"""
import json
import logging
import os
from urllib.parse import urlparse

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

OUR_PROPERTIES_KEY = "OUR_PROPERTIES"


def _normalize_url(raw):
    """Normalize input to full URL. Accepts domain or full URL."""
    s = str(raw).strip()
    if not s:
        return None
    s = s.lower()
    if not s.startswith("http://") and not s.startswith("https://"):
        s = "https://" + s
    parsed = urlparse(s)
    if not parsed.netloc:
        return None
    return s


def _domain_from_url(url):
    """Extract display domain (hostname) from URL."""
    parsed = urlparse(url)
    return parsed.netloc or url


def _site_to_entry(s):
    """Convert stored item to (url, description, title, logoKey). Handles legacy string format."""
    if isinstance(s, dict):
        url = (s.get("url") or "").strip()
        url = _normalize_url(url) if url else None
        desc = (s.get("description") or "").strip()[:255]
        title = (s.get("title") or "").strip()
        logo_key = (s.get("logoKey") or "").strip() or None
        return (url, desc, title, logo_key) if url else (None, None, None, None)
    url = _normalize_url(s) if isinstance(s, str) else None
    return (url, "", "", None) if url else (None, None, None, None)


def get_our_properties_sites():
    """Return list of (url, description) from DynamoDB. Handles legacy string list."""
    if not TABLE_NAME:
        return []
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": OUR_PROPERTIES_KEY}, "SK": {"S": "SITES"}},
        )
        if "Item" not in resp:
            return []
        data = resp["Item"].get("sites", {}).get("S", "[]")
        raw = json.loads(data)
        if not isinstance(raw, list):
            return []
        out = []
        for s in raw:
            url, desc, title, logo_key = _site_to_entry(s)
            if url:
                entry = {"url": url, "description": desc}
                if title:
                    entry["title"] = title
                if logo_key:
                    entry["logoKey"] = logo_key
                out.append(entry)
        return out
    except Exception as e:
        logger.warning("Our properties sites config read failed: %s", e)
        return []


def get_our_properties_updated_at():
    """Return updatedAt timestamp from cache, or None if never updated."""
    if not TABLE_NAME:
        return None
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": OUR_PROPERTIES_KEY}, "SK": {"S": "SITES"}},
            ProjectionExpression="updatedAt",
        )
        if "Item" not in resp:
            return None
        return resp["Item"].get("updatedAt", {}).get("S")
    except Exception as e:
        logger.warning("Our properties updatedAt read failed: %s", e)
        return None


def generate_highlights_cache_from_category():
    """
    Generate highlights cache from sites in the "highlight" category.
    Returns (sites_list, error). If error, sites_list may be partial/empty.
    """
    if not TABLE_NAME:
        return [], "TABLE_NAME not set"
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")

        # Find category named "highlight" (case-insensitive)
        cat_resp = dynamodb.query(
            TableName=TABLE_NAME,
            IndexName="byEntity",
            KeyConditionExpression="entityType = :et",
            ExpressionAttributeValues={":et": {"S": "CATEGORY"}},
        )
        highlight_cat_id = None
        for item in cat_resp.get("Items", []):
            pk = item.get("PK", {}).get("S", "")
            name = (item.get("name", {}).get("S", "") or "").strip().lower()
            if name == "highlight":
                highlight_cat_id = pk
                break

        if not highlight_cat_id:
            return [], "No category named 'highlight' found. Create one and assign it to sites."

        # Query all sites
        sites = []
        request_kw = {
            "TableName": TABLE_NAME,
            "IndexName": "byEntity",
            "KeyConditionExpression": "entityType = :et",
            "ExpressionAttributeValues": {":et": {"S": "SITE"}},
        }
        result = dynamodb.query(**request_kw)
        items = result.get("Items", [])
        while result.get("LastEvaluatedKey"):
            request_kw["ExclusiveStartKey"] = result["LastEvaluatedKey"]
            result = dynamodb.query(**request_kw)
            items.extend(result.get("Items", []))

        # Filter to sites with highlight category
        out = []
        for item in items:
            cat_ids = item.get("categoryIds", {}).get("L", [])
            cat_ids = [c.get("S", "") for c in cat_ids if c.get("S")]
            if highlight_cat_id not in cat_ids:
                continue
            url = (item.get("url", {}).get("S", "") or "").strip()
            if not url:
                continue
            url = _normalize_url(url) or url
            title = (item.get("title", {}).get("S", "") or "").strip()
            desc = (item.get("description", {}).get("S", "") or "").strip()[:255]
            logo_key = (item.get("logoKey", {}).get("S", "") or "").strip() or None
            entry = {"url": url, "description": desc}
            if title:
                entry["title"] = title
            if logo_key:
                entry["logoKey"] = logo_key
            out.append(entry)

        if not out:
            return [], "No sites in the 'highlight' category."

        if not save_our_properties_sites(out):
            return [], "Failed to save cache"

        return out, None
    except Exception as e:
        logger.exception("generate_highlights_cache error: %s", e)
        return [], str(e)


def normalize_sites(raw_list):
    """Normalize list of domains/URLs or {url,description,title,logoKey} to entries. Dedupe by URL, preserve order."""
    seen = set()
    out = []
    for s in raw_list:
        if isinstance(s, dict):
            url = _normalize_url(s.get("url") or "")
            desc = (s.get("description") or "").strip()[:255]
            title = (s.get("title") or "").strip()
            logo_key = (s.get("logoKey") or "").strip() or None
        else:
            url = _normalize_url(s)
            desc = ""
            title = ""
            logo_key = None
        if url and url not in seen:
            seen.add(url)
            entry = {"url": url, "description": desc}
            if title:
                entry["title"] = title
            if logo_key:
                entry["logoKey"] = logo_key
            out.append(entry)
    return out


def save_our_properties_sites(sites):
    """Save sites list [{url, description}] to DynamoDB (manager or admin)."""
    if not TABLE_NAME:
        return False
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb")
        now = datetime.utcnow().isoformat() + "Z"
        to_save = []
        for s in sites:
            if isinstance(s, dict):
                url = s.get("url") or ""
                desc = (s.get("description") or "").strip()[:255]
                title = (s.get("title") or "").strip()
                logo_key = (s.get("logoKey") or "").strip() or None
            else:
                url = str(s)
                desc = ""
                title = ""
                logo_key = None
            if url:
                entry = {"url": url, "description": desc}
                if title:
                    entry["title"] = title
                if logo_key:
                    entry["logoKey"] = logo_key
                to_save.append(entry)
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": OUR_PROPERTIES_KEY},
                "SK": {"S": "SITES"},
                "sites": {"S": json.dumps(to_save)},
                "updatedAt": {"S": now},
            },
        )
        return True
    except Exception as e:
        logger.warning("Our properties sites config write failed: %s", e)
        return False


def _add_logo_urls(entries):
    """Add logoUrl to entries that have logoKey. In-place."""
    media_bucket = os.environ.get("MEDIA_BUCKET", "")
    if not media_bucket:
        return
    for e in entries:
        key = e.get("logoKey")
        if not key or not isinstance(key, str) or not key.strip():
            continue
        try:
            import boto3
            s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
            e["logoUrl"] = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": media_bucket, "Key": key},
                ExpiresIn=3600,
            )
        except Exception as ex:
            logger.debug("Presigned logo URL failed for %s: %s", key, ex)


def fetch_our_properties():
    """Return list of sites from storage. No HTTP checks, PageSpeed, or external APIs."""
    entries = get_our_properties_sites()
    result = []
    for e in entries:
        domain = _domain_from_url(e["url"])
        item = {
            "url": e["url"],
            "domain": domain,
            "status": "up",
            "description": e.get("description", "") or "",
            "title": e.get("title") or domain,
        }
        if e.get("logoKey"):
            item["logoKey"] = e["logoKey"]
        result.append(item)
    _add_logo_urls(result)
    return result
