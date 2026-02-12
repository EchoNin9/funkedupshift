"""
Internet Dashboard: status of 20 popular sites (green/yellow/red).
Source cascade: Lambda HTTP -> UptimeRobot -> StatusCake -> Site Informant -> DynamoDB cache.
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
UPTIMEROBOT_API_KEY = os.environ.get("UPTIMEROBOT_API_KEY", "")
STATUSCAKE_API_KEY = os.environ.get("STATUSCAKE_API_KEY", "")

INTERNET_DASHBOARD_CACHE_KEY = "funkedupshift_internet_dashboard"
CACHE_TTL_SECONDS = 300  # 5 min

DEFAULT_SITES = [
    "google.com", "facebook.com", "youtube.com", "twitter.com", "instagram.com",
    "amazon.com", "netflix.com", "github.com", "stackoverflow.com", "reddit.com",
    "wikipedia.org", "linkedin.com", "microsoft.com", "apple.com", "cloudflare.com",
    "discord.com", "twitch.tv", "spotify.com", "zoom.us", "slack.com",
    "openai.com",
]


def get_dashboard_sites():
    """Return sites list from DynamoDB config, or DEFAULT_SITES if not set."""
    if not TABLE_NAME:
        return DEFAULT_SITES
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": "INTERNET_DASHBOARD"}, "SK": {"S": "SITES"}},
        )
        if "Item" not in resp:
            return DEFAULT_SITES
        data = resp["Item"].get("sites", {}).get("S", "[]")
        sites = json.loads(data)
        if isinstance(sites, list) and len(sites) >= 1:
            return [str(s).strip() for s in sites if str(s).strip()]
        return DEFAULT_SITES
    except Exception as e:
        logger.warning("Dashboard sites config read failed: %s", e)
        return DEFAULT_SITES


def save_dashboard_sites(sites):
    """Save sites list to DynamoDB (SuperAdmin only)."""
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
                "PK": {"S": "INTERNET_DASHBOARD"},
                "SK": {"S": "SITES"},
                "sites": {"S": json.dumps(sites)},
                "updatedAt": {"S": now},
            },
        )
        return True
    except Exception as e:
        logger.warning("Dashboard sites config write failed: %s", e)
        return False


def _check_url_http(url, timeout=5):
    """HEAD request, return (status, response_time_ms) or (None, None) on failure."""
    start = time.time()
    try:
        req = Request(url, method="HEAD")
        req.add_header("User-Agent", "FunkedUpShift-InternetDashboard/1.0")
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


def _fetch_level1_http(sites):
    """Level 1: Lambda HTTP HEAD to each site (parallel)."""
    domain_to_result = {}

    def check_one(domain):
        url = f"https://{domain}"
        status_code, response_time_ms = _check_url_http(url)
        status = _status_from_http(status_code, response_time_ms)
        return domain, {
            "domain": domain,
            "status": status,
            "source": "http",
            "responseTimeMs": response_time_ms,
        }

    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(check_one, d): d for d in sites}
        for fut in as_completed(futures, timeout=15):
            domain, data = fut.result()
            domain_to_result[domain] = data
    return [domain_to_result[d] for d in sites]


def _fetch_level2_uptimerobot(sites):
    """Level 2: UptimeRobot API. Requires UPTIMEROBOT_API_KEY and pre-created monitors."""
    if not UPTIMEROBOT_API_KEY:
        return None
    try:
        import urllib.request
        data = json.dumps({"api_key": UPTIMEROBOT_API_KEY}).encode()
        req = urllib.request.Request(
            "https://api.uptimerobot.com/v2/getMonitors",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
        monitors = body.get("monitors", [])
        by_url = {}
        for m in monitors:
            url = (m.get("url") or "").replace("https://", "").replace("http://", "").rstrip("/")
            if "/" in url:
                url = url.split("/")[0]
            by_url[url] = m
        results = []
        for domain in sites:
            m = by_url.get(domain)
            if m:
                st = m.get("status", 9)
                status = "up" if st == 2 else ("degraded" if st in (8, 9) else "down")
            else:
                status = "down"
            results.append({
                "domain": domain,
                "status": status,
                "source": "uptimerobot",
                "responseTimeMs": None,
            })
        return results
    except Exception as e:
        logger.warning("UptimeRobot fetch failed: %s", e)
        return None


def _fetch_level3_statuscake(sites):
    """Level 3: StatusCake API. Requires STATUSCAKE_API_KEY and pre-created tests."""
    if not STATUSCAKE_API_KEY:
        return None
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.statuscake.com/v1/uptime",
            headers={"Authorization": f"Bearer {STATUSCAKE_API_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
        by_url = {}
        for t in body:
            url = (t.get("website_url") or "").replace("https://", "").replace("http://", "").rstrip("/")
            if "/" in url:
                url = url.split("/")[0]
            by_url[url] = t
        results = []
        for domain in sites:
            t = by_url.get(domain)
            if t:
                uptime = t.get("uptime", 0)
                status = "up" if uptime >= 99 else ("degraded" if uptime >= 95 else "down")
            else:
                status = "down"
            results.append({
                "domain": domain,
                "status": status,
                "source": "statuscake",
                "responseTimeMs": None,
            })
        return results
    except Exception as e:
        logger.warning("StatusCake fetch failed: %s", e)
        return None


def _fetch_level4_site_informant(sites):
    """Level 4: Site Informant API. Only works for opted-in domains."""
    results = []
    has_valid = False
    for domain in sites:
        try:
            req = Request(f"https://api.siteinformant.com/api/public/status/{domain}")
            req.add_header("User-Agent", "FunkedUpShift-InternetDashboard/1.0")
            with urlopen(req, timeout=5) as resp:
                body = json.loads(resp.read().decode())
            is_online = body.get("isOnline", False)
            uptime = body.get("uptimePercent", 0)
            status = "up" if is_online else ("degraded" if uptime >= 90 else "down")
            if status != "down":
                has_valid = True
            results.append({
                "domain": domain,
                "status": status,
                "source": "siteinformant",
                "responseTimeMs": body.get("averageResponseMs"),
            })
        except Exception:
            results.append({
                "domain": domain,
                "status": "down",
                "source": "siteinformant",
                "responseTimeMs": None,
            })
    return results if has_valid else None


def _fetch_level5_dynamodb():
    """Level 5: DynamoDB cache of last successful result."""
    if not TABLE_NAME:
        return None
    try:
        import boto3
        dynamodb = boto3.client("dynamodb")
        resp = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": "INTERNET_DASHBOARD"}, "SK": {"S": "STATUS"}},
        )
        if "Item" not in resp:
            return None
        item = resp["Item"]
        data = item.get("data", {}).get("S", "{}")
        sites = json.loads(data)
        if isinstance(sites, list) and len(sites) >= 1:
            return sites
        return None
    except Exception as e:
        logger.warning("DynamoDB cache read failed: %s", e)
        return None


def _save_to_dynamodb(sites):
    """Save successful result to DynamoDB for Level 5 fallback."""
    if not TABLE_NAME:
        return
    try:
        import boto3
        from datetime import datetime
        dynamodb = boto3.client("dynamodb")
        now = datetime.utcnow().isoformat() + "Z"
        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item={
                "PK": {"S": "INTERNET_DASHBOARD"},
                "SK": {"S": "STATUS"},
                "data": {"S": json.dumps(sites)},
                "updatedAt": {"S": now},
            },
        )
        logger.info("Internet dashboard cache updated")
    except Exception as e:
        logger.warning("DynamoDB cache write failed: %s", e)


def fetchDashboard():
    """Fetch status from sources in cascade order. Return list of site dicts."""
    sites = get_dashboard_sites()
    sources = [
        ("http", lambda: _fetch_level1_http(sites)),
        ("uptimerobot", lambda: _fetch_level2_uptimerobot(sites)),
        ("statuscake", lambda: _fetch_level3_statuscake(sites)),
        ("siteinformant", lambda: _fetch_level4_site_informant(sites)),
        ("cache", _fetch_level5_dynamodb),
    ]
    for name, fn in sources:
        try:
            result = fn()
            if result and isinstance(result, list) and len(result) >= 1:
                _save_to_dynamodb(result)
                return result
        except Exception as e:
            logger.warning("Source %s failed: %s", name, e)
    return _fetch_level1_http(sites)  # Fallback: always return HTTP results even if partial
