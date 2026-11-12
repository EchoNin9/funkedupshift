"""HTTP Headers & Redirects tracer (FUNK-74): GET /tools/http?url=<u>.

Follows redirects by hand, one common.netguard Pinned*Connection per hop, so every hop's host
is resolved and checked (IPv4, public only) at connect time. No urllib redirect handling.

trace(raw_url) returns:
  {"input": str,                      # normalised first URL
   "hops": [{"url", "method": "HEAD"|"GET", "status", "reason", "httpVersion",
             "location": str|None, "nextUrl": str|None, "timeMs", "ip",
             "headers": [[name, value], ...],   # received order, repeats kept
             "truncated": bool}                 # >100 headers or a value >2048 chars cut
            # a failed hop has only {"url", "error"} (+ "method" if known)
           ],
   "stopReason": "final response"|"redirect loop"|"too many redirects"|"error"|"timed out",
   "finalUrl": str|None, "finalStatus": int|None, "totalMs": int,
   # the next four are omitted when no hop got a response; they describe the last such hop
   "security": [{"name", "present", "value", "ok", "note"}],
   "securityGrade": "A"|"B"|"C"|"D"|"F",
   "cache": {header: value},
   "cdn": {"detected": [str], "server": str|None, "poweredBy": str|None}}
and raises HttpTraceError(message) for invalid input (the caller shows a 400).
"""
import http.client
import socket
import ssl
import time
from urllib.parse import quote, urljoin, urlsplit, urlunsplit

from common.netguard import PinnedHTTPConnection, PinnedHTTPSConnection

ALLOWED_PORTS = (80, 443, 8080, 8443)
DEFAULT_PORTS = {"http": 80, "https": 443}
MAX_URL_LEN = 2048
MAX_HOPS = 10
MAX_HEADERS = 100
MAX_VALUE_LEN = 2048
BODY_PEEK = 4096
TOTAL_BUDGET_SEC = 12.0  # tools Lambda timeout is 15 s
HOP_TIMEOUT_SEC = 5.0
USER_AGENT = "FunkedupshiftHttpTrace/1.0"
REDIRECT_STATUSES = (301, 302, 303, 307, 308)
HSTS_MIN_AGE = 15552000  # 180 days


class HttpTraceError(Exception):
    pass


def parseUrl(raw):
    """Return (parts, error); parts = (url_without_fragment, scheme, host, port, target)."""
    url = (raw or "").strip()
    if not url:
        return None, "url is required"
    if len(url) > MAX_URL_LEN:
        return None, f"url must be at most {MAX_URL_LEN} characters"
    if any(ord(c) < 33 or ord(c) == 127 for c in url):
        return None, "url must not contain spaces or control characters"
    if "://" not in url:
        url = "https://" + url
    try:
        p = urlsplit(url)
        port = p.port
    except ValueError:
        return None, "url is not valid"
    scheme = p.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        return None, "only http and https URLs are allowed"
    if not p.hostname:
        return None, "url must include a hostname"
    if "@" in p.netloc:
        return None, "url must not contain a username or password"
    port = port or DEFAULT_PORTS[scheme]
    if port not in ALLOWED_PORTS:
        return None, "port must be one of: " + ", ".join(str(x) for x in ALLOWED_PORTS)
    try:
        host = p.hostname.encode("idna").decode("ascii")
    except UnicodeError:
        return None, "hostname is not valid"
    target = quote(p.path or "/", safe="%/:=&~+!$,;'@()*[]-._") + ("?" + quote(p.query, safe="%/:=&?~+!$,;'@()*[]-._") if p.query else "")
    return (urlunsplit((scheme, p.netloc, p.path or "/", p.query, "")), scheme, host, port, target), None


def _normalised(parts):
    _, scheme, host, port, target = parts
    return (scheme, host.lower(), port, target)


def _hostHeader(scheme, host, port):
    return host if port == DEFAULT_PORTS[scheme] else f"{host}:{port}"


def _fetch(parts, method, timeout):
    """One request on a fresh pinned connection. Returns the hop dict (without url)."""
    _, scheme, host, port, target = parts
    cls = PinnedHTTPSConnection if scheme == "https" else PinnedHTTPConnection
    conn = cls(host, port, timeout=timeout)
    start = time.monotonic()
    try:
        conn.request(method, target, headers={
            "Host": _hostHeader(scheme, host, port),
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
        })
        resp = conn.getresponse()
        ms = int((time.monotonic() - start) * 1000)
        ip = conn.sock.getpeername()[0] if conn.sock else None
        raw = list(resp.getheaders())
        if method == "GET":
            resp.read(BODY_PEEK)  # read and discard; the body is never returned
        truncated = len(raw) > MAX_HEADERS
        headers = []
        for name, value in raw[:MAX_HEADERS]:
            if len(value) > MAX_VALUE_LEN:
                value, truncated = value[:MAX_VALUE_LEN], True
            headers.append([name, value])
        return {
            "method": method,
            "status": resp.status,
            "reason": resp.reason,
            "httpVersion": {10: "HTTP/1.0", 11: "HTTP/1.1"}.get(resp.version, "HTTP/" + str(resp.version)),
            "timeMs": ms,
            "ip": ip,
            "headers": headers,
            "truncated": truncated,
        }
    finally:
        conn.close()


def _errorText(e):
    if isinstance(e, ssl.SSLCertVerificationError):
        return "certificate verify failed: " + (getattr(e, "verify_message", None) or getattr(e, "reason", None) or str(e))
    if isinstance(e, ssl.SSLError):
        return "TLS error: " + (getattr(e, "reason", None) or str(e))
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "connection timed out"
    if isinstance(e, ConnectionRefusedError):
        return "connection refused"
    if isinstance(e, ValueError):  # netguard refusals ("URL points to a non-public address", ...)
        return str(e)
    if isinstance(e, http.client.HTTPException):
        return "HTTP error: " + (str(e) or type(e).__name__)
    return "connection failed: " + (str(e) or type(e).__name__)


def _header(headers, name):
    name = name.lower()
    for k, v in headers:
        if k.lower() == name:
            return v
    return None


def _analyse(hop, scheme):
    headers = hop["headers"]
    get = lambda n: _header(headers, n)  # noqa: E731
    security = []

    def add(name, value, ok, note, present=None):
        security.append({"name": name, "present": value is not None if present is None else present,
                         "value": value, "ok": ok, "note": note})

    hsts = get("strict-transport-security")
    if scheme != "https":
        add("Strict-Transport-Security", hsts, False, "HSTS is ignored over plain http; browsers only honour it on https.")
    elif hsts is None:
        add("Strict-Transport-Security", None, False, "Missing. Browsers may be downgraded to http.")
    else:
        age = None
        for part in hsts.split(";"):
            k, _, v = part.strip().partition("=")
            if k.lower() == "max-age" and v.strip().strip('"').isdigit():
                age = int(v.strip().strip('"'))
        low = hsts.lower()
        extras = [x for x in ("includeSubDomains", "preload") if x.lower() in low]
        if age is None or age < HSTS_MIN_AGE:
            add("Strict-Transport-Security", hsts, False, f"max-age is {'missing' if age is None else age}; use at least {HSTS_MIN_AGE} (180 days).")
        else:
            add("Strict-Transport-Security", hsts, True, "max-age ok" + ("; " + ", ".join(extras) if extras else "; no includeSubDomains or preload"))

    csp = get("content-security-policy")
    cspro = get("content-security-policy-report-only")
    if csp is not None:
        add("Content-Security-Policy", csp, True, "Enforced.")
    elif cspro is not None:
        add("Content-Security-Policy", cspro, False, "Only Content-Security-Policy-Report-Only is set; it reports but does not enforce.", present=False)
    else:
        add("Content-Security-Policy", None, False, "Missing.")

    xcto = get("x-content-type-options")
    add("X-Content-Type-Options", xcto, (xcto or "").strip().lower() == "nosniff",
        "Missing." if xcto is None else ("nosniff" if xcto.strip().lower() == "nosniff" else "Should be nosniff."))

    xfo = get("x-frame-options")
    fa = csp is not None and "frame-ancestors" in csp.lower()
    xfo_ok = (xfo or "").strip().upper() in ("DENY", "SAMEORIGIN")
    if xfo_ok or fa:
        add("Clickjacking protection", xfo if xfo is not None else csp, True,
            "X-Frame-Options " + xfo.strip() if xfo_ok else "CSP frame-ancestors is set.")
    else:
        add("Clickjacking protection", xfo, False,
            "Missing. Set X-Frame-Options DENY/SAMEORIGIN or CSP frame-ancestors." if xfo is None
            else "X-Frame-Options should be DENY or SAMEORIGIN.")

    rp = get("referrer-policy")
    if rp is None:
        add("Referrer-Policy", None, False, "Missing.")
    elif "unsafe-url" in rp.lower():
        add("Referrer-Policy", rp, False, "unsafe-url leaks the full URL to every site.")
    else:
        add("Referrer-Policy", rp, True, "Set.")

    pp = get("permissions-policy")
    add("Permissions-Policy", pp, pp is not None, "Set." if pp is not None else "Missing.")

    # Grade by number of ok checks out of 6: A=6, B=5, C=4, D=3, F=2 or fewer.
    grade = {6: "A", 5: "B", 4: "C", 3: "D"}.get(sum(1 for s in security if s["ok"]), "F")

    cache = {}
    for n in ("Cache-Control", "Expires", "Age", "ETag", "Last-Modified", "Vary", "X-Cache", "Via"):
        v = get(n)
        if v is not None:
            cache[n] = v

    names = {k.lower() for k, _ in headers}
    server = get("server")
    via = (get("via") or "").lower()
    detected = []
    if "x-amz-cf-id" in names or "x-amz-cf-pop" in names or "cloudfront" in via:
        detected.append("CloudFront")
    if "cf-ray" in names:
        detected.append("Cloudflare")
    if "x-fastly-request-id" in names or "cache-" in (get("x-served-by") or "").lower():
        detected.append("Fastly")
    if any(n.startswith("x-akamai-") for n in names) or "akamaighost" in (server or "").lower():
        detected.append("Akamai")
    if "x-vercel-id" in names:
        detected.append("Vercel")
    if "x-nf-request-id" in names:
        detected.append("Netlify")
    return security, grade, cache, {"detected": detected, "server": server, "poweredBy": get("x-powered-by")}


def trace(raw_url):
    first, err = parseUrl(raw_url)
    if err:
        raise HttpTraceError(err)
    start = time.monotonic()
    deadline = start + TOTAL_BUDGET_SEC
    hops, visited, parts, stop = [], {_normalised(first)}, first, "final response"
    schemes = {}
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0.05:
            stop = "timed out"
            break
        timeout = min(HOP_TIMEOUT_SEC, remaining)
        hop = {"url": parts[0]}
        try:
            res = _fetch(parts, "HEAD", timeout)
            if res["status"] in (405, 501):
                res = _fetch(parts, "GET", max(0.1, min(HOP_TIMEOUT_SEC, deadline - time.monotonic())))
        except Exception as e:  # every failure mode ends the trace as data, never a 500
            hop["error"] = _errorText(e)
            hops.append(hop)
            stop = "timed out" if deadline - time.monotonic() <= 0 and "timed out" in hop["error"] else "error"
            break
        loc = _header(res["headers"], "location")
        hop.update(res)
        hop["location"] = loc
        hop["nextUrl"] = urljoin(parts[0], loc) if loc else None
        hops.append(hop)
        schemes[len(hops) - 1] = parts[1]
        if res["status"] not in REDIRECT_STATUSES or not loc:
            break
        nxt, err = parseUrl(hop["nextUrl"])
        if err:
            hops.append({"url": hop["nextUrl"], "error": "redirect not followed: " + err})
            stop = "error"
            break
        key = _normalised(nxt)
        if key in visited:
            stop = "redirect loop"
            break
        if len(hops) >= MAX_HOPS:
            stop = "too many redirects"
            break
        visited.add(key)
        parts = nxt

    out = {"input": first[0], "hops": hops, "stopReason": stop, "finalUrl": None, "finalStatus": None}
    answered = [i for i, h in enumerate(hops) if "status" in h]
    if answered:
        i = answered[-1]
        out["finalUrl"], out["finalStatus"] = hops[i]["url"], hops[i]["status"]
    out["totalMs"] = int((time.monotonic() - start) * 1000)
    if answered:
        out["security"], out["securityGrade"], out["cache"], out["cdn"] = _analyse(hops[i], schemes[i])
    return out
