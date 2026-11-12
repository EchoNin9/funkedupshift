"""
SSRF-safe outbound networking shared by the API and tools Lambdas: every connection goes to an
IPv4 address we just validated as globally routable (resolve once, connect to that IP).
"""
import http.client
import ipaddress
import socket
import ssl
import urllib.parse
import urllib.request

PAGE_UA = "Mozilla/5.0 (compatible; Funkedupshift/1.0; +https://github.com)"


def public_ip(host, port):
    """Resolve host and return its first IPv4 address, refusing if ANY answer is non-public."""
    try:
        # IPv4 only on purpose: Lambda has no IPv6 egress, and it rules out NAT64/6to4/Teredo/mapped embedding tricks.
        infos = socket.getaddrinfo(host, port, family=socket.AF_INET, type=socket.SOCK_STREAM)
    except socket.gaierror:
        infos = []
    if not infos:
        raise ValueError("Could not resolve host")
    ips = [i[4][0] for i in infos]
    for ip in ips:
        a = ipaddress.ip_address(ip)
        # not is_global also covers CGNAT 100.64/10 and other special-purpose ranges
        if not a.is_global or a.is_multicast:
            raise ValueError("URL points to a non-public address")
    return ips[0]


_TLS = ssl.create_default_context()


def pinned_socket(conn):
    # Connect to the address we just validated, so a second DNS answer cannot redirect us.
    return socket.create_connection((public_ip(conn.host, conn.port), conn.port), conn.timeout)


class PinnedHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = pinned_socket(self)


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        # Verify the certificate against the real hostname while the TCP connection goes to the pinned IP.
        self.sock = _TLS.wrap_socket(pinned_socket(self), server_hostname=self.host)


class _PinnedHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(PinnedHTTPConnection, req)


class _PinnedHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(PinnedHTTPSConnection, req)


class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5

    def http_error_302(self, req, fp, code, msg, headers):
        # urllib itself only rejects schemes other than http/https/ftp; refuse everything but http(s) here.
        if urllib.parse.urlparse(headers.get("location") or headers.get("uri") or "").scheme not in ("http", "https", ""):
            raise ValueError("Only http and https URLs are allowed")
        return super().http_error_302(req, fp, code, msg, headers)

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = http_error_302


def _opener():
    # Minimal opener: no proxy, ftp, file or data handlers, so no other scheme or env proxy is reachable.
    o = urllib.request.OpenerDirector()
    for h in (_PinnedHTTPHandler(), _PinnedHTTPSHandler(), _GuardedRedirect(),
              urllib.request.HTTPErrorProcessor(), urllib.request.HTTPDefaultErrorHandler()):
        o.add_handler(h)
    return o


def safe_fetch(url, max_bytes, timeout, user_agent=PAGE_UA):
    """GET url, refusing non-public hosts (checked at connect time on every hop). Returns (bytes, content_type, final_url)."""
    url = url.strip()
    if "://" not in url:
        url = "https://" + url
    p = urllib.parse.urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ValueError("Only http and https URLs are allowed")
    req = urllib.request.Request(url, headers={"User-Agent": user_agent}, method="GET")
    with _opener().open(req, timeout=timeout) as resp:
        data = resp.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise ValueError(f"Response too large (max {max_bytes} bytes)")
        ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        return data, ctype, resp.geturl()
