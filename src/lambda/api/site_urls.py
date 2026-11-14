"""Site URL normalization used ONLY for duplicate comparison (URLs are stored as entered)."""
import re
from urllib.parse import urlsplit


def normalize_site_url(raw):
    s = (raw or "").strip()
    if not s:
        return ""
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", s):
        s = "https://" + s.lstrip("/")
    try:
        p = urlsplit(s)
        host = (p.hostname or "").lower()
        port = p.port
    except ValueError:
        return s.lower()
    if host.startswith("www."):
        host = host[4:]
    if port and port not in (80, 443):
        host = f"{host}:{port}"
    path = p.path.rstrip("/")
    query = f"?{p.query}" if p.query else ""
    return f"{host}{path}{query}"
