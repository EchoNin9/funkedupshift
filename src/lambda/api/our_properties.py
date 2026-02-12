"""
Our Properties: status of our own sites (dashboard-style grid).
Same HTTP check logic as internet dashboard - no external APIs.
"""
import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

OUR_PROPERTIES_KEY = "OUR_PROPERTIES"


def get_our_properties_sites():
    """Return sites list from DynamoDB, or empty list if not set."""
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
        sites = json.loads(data)
        if isinstance(sites, list) and len(sites) >= 1:
            return [str(s).strip() for s in sites if str(s).strip()]
        return []
    except Exception as e:
        logger.warning("Our properties sites config read failed: %s", e)
        return []


def save_our_properties_sites(sites):
    """Save sites list to DynamoDB (manager or admin)."""
    if not TABLE_NAME:
        return False
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb")
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": OUR_PROPERTIES_KEY},
                "SK": {"S": "SITES"},
                "sites": {"S": json.dumps(sites)},
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
    """Fetch status from HTTP HEAD for each site. Return list of site dicts."""
    sites = get_our_properties_sites()
    if not sites:
        return []

    domain_to_result = {}

    def check_one(domain):
        url = f"https://{domain}"
        status_code, response_time_ms = _check_url_http(url)
        status = _status_from_http(status_code, response_time_ms)
        return domain, {
            "domain": domain,
            "status": status,
            "responseTimeMs": response_time_ms,
        }

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(check_one, d): d for d in sites}
        for fut in as_completed(futures, timeout=15):
            domain, data = fut.result()
            domain_to_result[domain] = data
    return [domain_to_result[d] for d in sites]
