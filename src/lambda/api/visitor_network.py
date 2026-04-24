"""
Server-side lookup of ipwho.is for the visitor's IP.

Browser calls to ipwho.is are blocked on the free plan (CORS / origin policy);
Lambda calls are not subject to that restriction.
"""
import ipaddress
import json
import logging
from urllib.parse import quote
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

IPWHO_BASE = "https://ipwho.is"
USER_AGENT = "FunkedUpShift-VisitorNetwork/1.0"
TIMEOUT_SEC = 10


def _validated_ip(raw: str) -> str:
    """Return IP string suitable for URL path, or raise ValueError."""
    s = (raw or "").strip()
    if not s:
        raise ValueError("empty ip")
    # Strip zone id (e.g. fe80::1%en0)
    if "%" in s:
        s = s.split("%", 1)[0]
    try:
        ipaddress.ip_address(s)
    except ValueError as e:
        raise ValueError("invalid ip") from e
    return s


def _ip_url_path(ip: str) -> str:
    """Encode IPv6 for URL path; IPv4 left as-is."""
    if ":" in ip:
        return quote(ip, safe="")
    return ip


def fetch_ipwho_for_ip(ip: str):
    """
    GET https://ipwho.is/{ip} and return parsed JSON dict.
    Raises on HTTP errors, invalid JSON, or invalid ip.
    """
    validated = _validated_ip(ip)
    path_seg = _ip_url_path(validated)
    url = f"{IPWHO_BASE}/{path_seg}"
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=TIMEOUT_SEC) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)
