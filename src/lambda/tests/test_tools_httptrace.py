"""Unit tests for the HTTP Headers & Redirects tracer (src/lambda/tools/httptrace.py, GET /tools/http).

No network. Redirect/analysis tests patch the connection classes as httptrace imports them; SSRF tests
leave them real and patch socket.getaddrinfo / socket.create_connection so the netguard path runs.
"""
import json
import socket
import ssl
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import handler as th  # noqa: E402
from tools import httptrace  # noqa: E402


def _event(query):
    return {
        "rawPath": "/tools/http",
        "requestContext": {"http": {"method": "GET", "path": "/tools/http"}},
        "queryStringParameters": query,
    }


def _call(query):
    r = th.handler(_event(query), None)
    return r["statusCode"], json.loads(r["body"])


class FakeResp:
    def __init__(self, status=200, headers=(), reason="OK", version=11, body=b"SECRET-BODY"):
        self.status, self.reason, self.version = status, reason, version
        self._headers, self._body = list(headers), body
        self.read_n = None

    def getheaders(self):
        return self._headers

    def read(self, n=None):
        self.read_n = n
        return self._body[:n]


def R(status=200, headers=(), **kw):
    return FakeResp(status, headers, **kw)


def redirect(status, location):
    return R(status, [("Location", location)], reason="Moved")


class Net:
    """Scripted connections. script: {"https://a.test/": {"HEAD": resp | exc, "GET": ...}}; a bare
    response (or exception) is used for HEAD."""

    def __init__(self, script):
        self.script, self.requests, self.timeouts = script, [], []

    def factory(self, scheme):
        net = self

        class Conn:
            def __init__(self, host, port, timeout=None):
                self.host, self.port = host, port
                net.timeouts.append(timeout)
                self.sock = None
                self.closed = False
                self.pending = None

            def request(self, method, target, headers=None):
                default = 443 if scheme == "https" else 80
                hp = self.host if self.port == default else f"{self.host}:{self.port}"
                url = f"{scheme}://{hp}{target}"
                net.requests.append((method, url, headers))
                entry = net.script[url]
                if not isinstance(entry, dict):
                    entry = {"HEAD": entry}
                self.pending = entry[method]
                if isinstance(self.pending, BaseException):
                    raise self.pending
                self.sock = type("S", (), {"getpeername": lambda s: ("93.184.216.34", self.port)})()

            def getresponse(self):
                return self.pending

            def close(self):
                self.closed = True

        return Conn

    def __enter__(self):
        self.p1 = patch("tools.httptrace.PinnedHTTPConnection", self.factory("http"))
        self.p2 = patch("tools.httptrace.PinnedHTTPSConnection", self.factory("https"))
        self.p1.start(), self.p2.start()
        return self

    def __exit__(self, *a):
        self.p1.stop(), self.p2.stop()


def run(script, url):
    with Net(script) as net:
        return httptrace.trace(url), net


# ---- input ----

def test_missing_url_400():
    assert _call({})[0] == 400
    assert _call({"url": "  "})[0] == 400


@pytest.mark.parametrize("url", [
    "ftp://x", "http://user:pw@example.com", "https://example.com:22/", "http://example.com:3306",
    "https://", "x" * 2049, "https://exa mple.com",
])
def test_bad_input_400(url):
    status, body = _call({"url": url})
    assert status == 400 and body["error"]


def test_no_scheme_gets_https():
    out, net = run({"https://example.com/": R()}, "example.com")
    assert out["input"] == "https://example.com/"
    assert net.requests[0][1] == "https://example.com/"


def test_headers_sent():
    out, net = run({"http://example.com:8080/a?b=1": R()}, "http://example.com:8080/a?b=1#frag")
    method, url, h = net.requests[0]
    assert method == "HEAD"
    assert h["Host"] == "example.com:8080" and h["User-Agent"] == "FunkedupshiftHttpTrace/1.0" and h["Accept"] == "*/*"


# ---- chain ----

def test_http_to_https_chain():
    out, net = run({
        "http://example.com/": redirect(301, "https://example.com/"),
        "https://example.com/": R(200),
    }, "http://example.com")
    assert [h["status"] for h in out["hops"]] == [301, 200]
    assert out["hops"][0]["nextUrl"] == "https://example.com/"
    assert out["hops"][0]["location"] == "https://example.com/"
    assert out["hops"][1]["nextUrl"] is None
    assert out["hops"][0]["ip"] == "93.184.216.34"
    assert out["hops"][0]["httpVersion"] == "HTTP/1.1" and out["hops"][0]["method"] == "HEAD"
    assert out["stopReason"] == "final response"
    assert out["finalUrl"] == "https://example.com/" and out["finalStatus"] == 200
    assert isinstance(out["totalMs"], int)


def test_relative_location_and_303():
    out, _ = run({
        "https://example.com/a/b": redirect(303, "../c?x=1"),
        "https://example.com/c?x=1": R(200),
    }, "https://example.com/a/b")
    assert out["hops"][0]["nextUrl"] == "https://example.com/c?x=1"
    assert [h["status"] for h in out["hops"]] == [303, 200]


def test_redirect_without_location_is_final():
    out, _ = run({"https://example.com/": R(302)}, "https://example.com/")
    assert len(out["hops"]) == 1 and out["stopReason"] == "final response"


def test_head_405_falls_back_to_get_and_body_hidden():
    resp = R(200, [("Content-Type", "text/plain")])
    out, net = run({"https://example.com/": {"HEAD": R(405, reason="Method Not Allowed"), "GET": resp}},
                   "https://example.com/")
    assert [r[0] for r in net.requests] == ["HEAD", "GET"]
    assert len(out["hops"]) == 1 and out["hops"][0]["method"] == "GET" and out["hops"][0]["status"] == 200
    assert resp.read_n == 4096
    assert "SECRET-BODY" not in json.dumps(out)


def test_loop_detected():
    out, _ = run({
        "https://a.test/": redirect(302, "https://B.test:443/#x"),
        "https://b.test/": redirect(302, "https://a.test/"),
    }, "https://a.test/")
    assert out["stopReason"] == "redirect loop" and len(out["hops"]) == 2


def test_too_many_redirects():
    script = {"https://h.test/": redirect(302, "/1")}
    for i in range(1, 12):
        script[f"https://h.test/{i}"] = redirect(302, f"/{i + 1}")
    out, _ = run(script, "https://h.test/")
    assert out["stopReason"] == "too many redirects" and len(out["hops"]) == 10


@pytest.mark.parametrize("loc,msg", [("ftp://evil.test/x", "http and https"), ("https://x.test:22/", "port")])
def test_redirect_to_bad_target_is_hop_error(loc, msg):
    with Net({"https://a.test/": redirect(301, loc)}):
        status, body = _call({"url": "https://a.test/"})
    assert status == 200
    assert body["stopReason"] == "error" and msg in body["hops"][-1]["error"]
    assert body["hops"][-1]["url"] == loc
    assert body["finalStatus"] == 301


# ---- SSRF (real netguard path) ----

@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "100.64.0.1"])
def test_first_hop_private_refused(ip):
    infos = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80))]
    with patch("socket.getaddrinfo", return_value=infos), patch("socket.create_connection") as cc:
        status, body = _call({"url": "http://sneaky.test/"})
    assert status == 200
    assert "non-public" in body["hops"][0]["error"] and body["stopReason"] == "error"
    cc.assert_not_called()
    assert "security" not in body


def test_redirect_to_metadata_refused_on_second_hop():
    def gai(host, port, **kw):
        ip = "93.184.216.34" if host == "public.test" else "169.254.169.254"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    class Sock:
        def __init__(self):
            self.data = b"HTTP/1.1 302 Found\r\nLocation: http://meta.test/latest\r\n\r\n"

        def makefile(self, *a, **k):
            import io
            return io.BytesIO(self.data)

        def sendall(self, b):
            pass

        def getpeername(self):
            return ("93.184.216.34", 80)

        def close(self):
            pass

    with patch("socket.getaddrinfo", side_effect=gai), patch("socket.create_connection", return_value=Sock()) as cc:
        status, body = _call({"url": "http://public.test/"})
    assert status == 200 and len(body["hops"]) == 2
    assert body["hops"][0]["status"] == 302
    assert "non-public" in body["hops"][1]["error"]
    assert [c.args[0] for c in cc.call_args_list] == [("93.184.216.34", 80)]


# ---- errors ----

@pytest.mark.parametrize("exc,text", [
    (socket.timeout("t"), "timed out"),
    (ConnectionRefusedError(), "connection refused"),
    (ssl.SSLCertVerificationError(1, "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate"), "certificate verify failed"),
    (ssl.SSLError(1, "boom"), "TLS error"),
    (__import__("http.client").client.RemoteDisconnected("gone"), "HTTP error"),
])
def test_hop_errors(exc, text):
    with Net({"https://a.test/": exc}):
        status, body = _call({"url": "https://a.test/"})
    assert status == 200 and body["stopReason"] == "error"
    assert text in body["hops"][0]["error"]
    assert "status" not in body["hops"][0]


def test_cert_error_message_has_reason():
    e = ssl.SSLCertVerificationError(1, "x")
    e.verify_message = "self-signed certificate"
    with Net({"https://a.test/": e}):
        _, body = _call({"url": "https://a.test/"})
    assert body["hops"][0]["error"] == "certificate verify failed: self-signed certificate"


def test_budget_exhausted_times_out():
    with Net({"https://a.test/": R()}), patch("tools.httptrace.TOTAL_BUDGET_SEC", 0):
        out = httptrace.trace("https://a.test/")
    assert out["stopReason"] == "timed out" and out["hops"] == []


def test_hop_timeout_capped_by_remaining():
    out, net = run({"https://a.test/": R()}, "https://a.test/")
    assert 0 < net.timeouts[0] <= 5


# ---- security grading ----

GOOD = [
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"),
    ("Content-Security-Policy", "default-src 'self'"),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Referrer-Policy", "no-referrer"),
    ("Permissions-Policy", "camera=()"),
]


def sec(out):
    return {s["name"]: s for s in out["security"]}


def test_all_good_is_A():
    out, _ = run({"https://a.test/": R(200, GOOD)}, "https://a.test/")
    assert out["securityGrade"] == "A" and all(s["ok"] for s in out["security"])
    assert "includeSubDomains" in sec(out)["Strict-Transport-Security"]["note"]


def test_missing_hsts_and_grade_B():
    out, _ = run({"https://a.test/": R(200, GOOD[1:])}, "https://a.test/")
    assert sec(out)["Strict-Transport-Security"]["ok"] is False
    assert sec(out)["Strict-Transport-Security"]["present"] is False
    assert out["securityGrade"] == "B"


def test_short_hsts_not_ok_and_grades():
    out, _ = run({"https://a.test/": R(200, [GOOD[0][0:1] + ("max-age=100",)] + GOOD[1:])}, "https://a.test/")
    assert sec(out)["Strict-Transport-Security"]["ok"] is False
    out, _ = run({"https://a.test/": R(200, GOOD[2:])}, "https://a.test/")
    assert out["securityGrade"] == "C"
    out, _ = run({"https://a.test/": R(200, GOOD[3:])}, "https://a.test/")
    assert out["securityGrade"] == "D"
    out, _ = run({"https://a.test/": R(200)}, "https://a.test/")
    assert out["securityGrade"] == "F"


def test_csp_report_only_noted():
    out, _ = run({"https://a.test/": R(200, [("Content-Security-Policy-Report-Only", "default-src 'self'")])}, "https://a.test/")
    s = sec(out)["Content-Security-Policy"]
    assert s["ok"] is False and "does not enforce" in s["note"]


def test_frame_ancestors_satisfies_clickjacking():
    out, _ = run({"https://a.test/": R(200, [("Content-Security-Policy", "frame-ancestors 'none'")])}, "https://a.test/")
    assert sec(out)["Clickjacking protection"]["ok"] is True


def test_hsts_on_http_ignored():
    out, _ = run({"http://a.test/": R(200, GOOD[:1])}, "http://a.test/")
    s = sec(out)["Strict-Transport-Security"]
    assert s["ok"] is False and "ignored" in s["note"]


def test_referrer_unsafe_url():
    out, _ = run({"https://a.test/": R(200, [("Referrer-Policy", "unsafe-url")])}, "https://a.test/")
    assert sec(out)["Referrer-Policy"]["ok"] is False


# ---- cache / cdn / headers ----

def test_cdn_cloudfront_and_cloudflare():
    out, _ = run({"https://a.test/": R(200, [("X-Amz-Cf-Pop", "YUL62"), ("Server", "AmazonS3"), ("Cache-Control", "max-age=60"), ("X-Powered-By", "PHP")])}, "https://a.test/")
    assert out["cdn"] == {"detected": ["CloudFront"], "server": "AmazonS3", "poweredBy": "PHP"}
    assert out["cache"] == {"Cache-Control": "max-age=60"}
    out, _ = run({"https://a.test/": R(200, [("CF-RAY", "abc-YUL"), ("Via", "1.1 x.cloudfront.net (CloudFront)")])}, "https://a.test/")
    assert out["cdn"]["detected"] == ["CloudFront", "Cloudflare"]
    assert out["cache"]["Via"].startswith("1.1")


def test_repeated_set_cookie_preserved_in_order():
    hs = [("Set-Cookie", "a=1"), ("Content-Type", "x"), ("Set-Cookie", "b=2")]
    out, _ = run({"https://a.test/": R(200, hs)}, "https://a.test/")
    assert out["hops"][0]["headers"] == [["Set-Cookie", "a=1"], ["Content-Type", "x"], ["Set-Cookie", "b=2"]]
    assert out["hops"][0]["truncated"] is False


def test_header_cap_and_value_truncation():
    many = [(f"X-H{i}", "v") for i in range(150)]
    out, _ = run({"https://a.test/": R(200, many)}, "https://a.test/")
    assert len(out["hops"][0]["headers"]) == 100 and out["hops"][0]["truncated"] is True
    out, _ = run({"https://a.test/": R(200, [("X-Long", "a" * 5000)])}, "https://a.test/")
    assert len(out["hops"][0]["headers"][0][1]) == 2048 and out["hops"][0]["truncated"] is True


def test_route_returns_200_json():
    with Net({"https://a.test/": R(200, GOOD)}):
        status, body = _call({"url": "a.test"})
    assert status == 200 and body["securityGrade"] == "A"
