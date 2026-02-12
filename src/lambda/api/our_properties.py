"""
Our Properties: status of our own sites (dashboard-style grid).
Same HTTP check logic as internet dashboard - no external APIs.
Stores full URLs; returns url + domain for display.
"""
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

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
    """Convert stored item to (url, description). Handles legacy string format."""
    if isinstance(s, dict):
        url = (s.get("url") or "").strip()
        url = _normalize_url(url) if url else None
        desc = (s.get("description") or "").strip()[:255]
        return (url, desc) if url else (None, None)
    url = _normalize_url(s) if isinstance(s, str) else None
    return (url, "") if url else (None, None)


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
            url, desc = _site_to_entry(s)
            if url:
                out.append({"url": url, "description": desc})
        return out
    except Exception as e:
        logger.warning("Our properties sites config read failed: %s", e)
        return []


def normalize_sites(raw_list):
    """Normalize list of domains/URLs or {url,description} to entries. Dedupe by URL, preserve order."""
    seen = set()
    out = []
    for s in raw_list:
        if isinstance(s, dict):
            url = _normalize_url(s.get("url") or "")
            desc = (s.get("description") or "").strip()[:255]
        else:
            url = _normalize_url(s)
            desc = ""
        if url and url not in seen:
            seen.add(url)
            out.append({"url": url, "description": desc})
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
            else:
                url = str(s)
                desc = ""
            if url:
                to_save.append({"url": url, "description": desc})
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


def _check_url_http(url, timeout=5):
    """HEAD request, return (status, response_time_ms) or (None, None) on failure."""
    start = time.time()
    try:
        req = Request(url, method="HEAD")
        req.add_header("User-Agent", "FunkedUpShift-OurProperties/1.0")
        with urlopen(req, timeout=timeout) as resp:
            elapsed_ms = int((time.time() - start) * 1000)
            return (resp.status, elapsed_ms)
    except HTTPError as e:
        elapsed_ms = int((time.time() - start) * 1000)
        return (e.code, elapsed_ms)
    except (URLError, OSError, Exception) as e:
        logger.debug("HTTP check failed for %s: %s", url, e)
        return (None, None)


def _status_from_http(status_code, response_time_ms):
    """Map HTTP result to up/degraded/down."""
    if status_code is None:
        return "down"
    if 200 <= status_code < 300:
        if response_time_ms is not None and response_time_ms >= 3000:
            return "degraded"
        return "up"
    if 300 <= status_code < 500:
        return "degraded"
    return "down"


def fetch_our_properties():
    """Fetch status from HTTP HEAD for each site. Return list of site dicts with url, domain, status, description."""
    entries = get_our_properties_sites()
    if not entries:
        return []

    url_to_desc = {e["url"]: e.get("description", "") or "" for e in entries}
    urls = [e["url"] for e in entries]

    url_to_result = {}

    def check_one(url):
        status_code, response_time_ms = _check_url_http(url)
        status = _status_from_http(status_code, response_time_ms)
        domain = _domain_from_url(url)
        return url, {
            "url": url,
            "domain": domain,
            "status": status,
            "responseTimeMs": response_time_ms,
            "description": url_to_desc.get(url, ""),
        }

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(check_one, u): u for u in urls}
        for fut in as_completed(futures, timeout=15):
            url, data = fut.result()
            url_to_result[url] = data
    return [url_to_result[u] for u in urls]
