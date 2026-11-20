"""Unit tests for feeds.fetch (SSRF netguard pinning, redirects, 304, gzip bombs, autodiscovery)."""

import gzip
import io
import socket
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from feeds import fetch  # noqa: E402


class _FakeResp:
    def __init__(self, status, headers, body=b""):
        self.status = status
        self._headers = headers
        self._buf = io.BytesIO(body)

    def getheaders(self):
        return list(self._headers.items())

    def getheader(self, name, default=None):
        low = name.lower()
        for k, v in self._headers.items():
            if k.lower() == low:
                return v
        return default

    def read(self, n=-1):
        return self._buf.read(n)


class _FakeConn:
    def __init__(self, host, port, timeout=10, responder=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._responder = responder
        self.requests = []
        self.closed = False

    def request(self, method, target, headers=None):
        self.requests.append((method, target, headers or {}))

    def getresponse(self):
        return self._responder(self.host, self.port, self.requests[-1])

    def close(self):
        self.closed = True


@pytest.mark.parametrize(
    "badIp",
    ["127.0.0.1", "10.0.0.1", "172.16.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1"],
)
def test_ssrf_blocks_private_and_metadata_ips_via_real_netguard(badIp):
    def fakeAddrInfo(host, port, family=0, type=0):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (badIp, port))]

    with (
        patch("common.netguard.socket.getaddrinfo", side_effect=fakeAddrInfo),
        patch("common.netguard.socket.create_connection", side_effect=AssertionError("should not connect")),
    ):
        with pytest.raises(fetch.FeedFetchError, match="non-public address"):
            fetch.fetchUrl("https://evil.example.com/feed.xml")


@pytest.mark.parametrize(
    "badUrl",
    [
        "",
        "file:///etc/passwd",
        "ftp://example.com/feed.xml",
        "javascript:alert(1)",
        "https://user:pass@example.com/feed.xml",
        "https://example.com:22/feed.xml",
        "https://example.com/bad path",
    ],
)
def test_parse_feed_url_rejects_unsafe_urls(badUrl):
    with pytest.raises(fetch.FeedFetchError):
        fetch.parseFeedUrl(badUrl)


def test_redirect_to_private_ip_is_blocked():
    def fakeAddrInfo(host, port, family=0, type=0):
        ip = "93.184.216.34" if host == "public.example" else "169.254.169.254"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    def fakeCreateConn(addr, timeout=None):
        ip, _ = addr
        raise AssertionError(f"unexpected direct socket call to {ip}")

    # Test real redirect handling through fetchUrl where hop 1 returns 302 to 169.254.169.254
    # and hop 2 hits real netguard.public_ip.
    from common.netguard import public_ip

    class _Hop1Conn(_FakeConn):
        def getresponse(self):
            if self.host == "public.example":
                return _FakeResp(302, {"Location": "http://169.254.169.254/latest/meta-data/"})
            public_ip(self.host, self.port)
            raise AssertionError("should have failed netguard")

    with (
        patch("common.netguard.socket.getaddrinfo", side_effect=fakeAddrInfo),
        patch("common.netguard.socket.create_connection", side_effect=fakeCreateConn),
        patch("feeds.fetch.PinnedHTTPSConnection", _Hop1Conn),
        patch("feeds.fetch.PinnedHTTPConnection", _Hop1Conn),
    ):
        with pytest.raises(fetch.FeedFetchError, match="non-public address"):
            fetch.fetchUrl("https://public.example/feed")


def test_redirect_limit_and_loop_detection():
    def loopResp(host, port, req):
        return _FakeResp(301, {"Location": f"https://{host}/a"})

    with patch("feeds.fetch.PinnedHTTPSConnection", lambda h, p, timeout=10: _FakeConn(h, p, timeout, loopResp)):
        with pytest.raises(fetch.FeedFetchError, match="Redirect loop"):
            fetch.fetchUrl("https://example.com/a")

    hop = 0

    def chainResp(host, port, req):
        nonlocal hop
        hop += 1
        return _FakeResp(302, {"Location": f"https://{host}/step{hop}"})

    with patch("feeds.fetch.PinnedHTTPSConnection", lambda h, p, timeout=10: _FakeConn(h, p, timeout, chainResp)):
        with pytest.raises(fetch.FeedFetchError, match="Too many redirects"):
            fetch.fetchUrl("https://example.com/start", maxRedirects=3)


def test_conditional_get_304_not_modified():
    seenHeaders = {}

    def okResp(host, port, req):
        seenHeaders.update(req[2])
        return _FakeResp(304, {"ETag": '"v2"', "Last-Modified": "Thu, 19 Nov 2026 00:00:00 GMT"})

    with patch("feeds.fetch.PinnedHTTPSConnection", lambda h, p, timeout=10: _FakeConn(h, p, timeout, okResp)):
        res = fetch.fetchUrl("https://example.com/rss", etag='"v1"', lastModified="Wed, 18 Nov 2026 00:00:00 GMT")

    assert res.notModified is True
    assert res.status == 304
    assert res.etag == '"v2"'
    assert seenHeaders["If-None-Match"] == '"v1"'
    assert seenHeaders["If-Modified-Since"] == "Wed, 18 Nov 2026 00:00:00 GMT"


def test_gzip_decompression_and_zip_bomb_guard():
    smallGz = gzip.compress(b"<rss version='2.0'><channel><title>Gz</title></channel></rss>")
    with patch(
        "feeds.fetch.PinnedHTTPSConnection",
        lambda h, p, timeout=10: _FakeConn(h, p, timeout, lambda *_: _FakeResp(200, {"Content-Encoding": "gzip", "Content-Type": "application/xml"}, smallGz)),
    ):
        res = fetch.fetchUrl("https://example.com/gz", maxBytes=4096)
    assert b"<title>Gz</title>" in res.body

    bombGz = gzip.compress(b"A" * 20_000)
    assert len(bombGz) < 1024  # small wire payload that expands past maxBytes
    with patch(
        "feeds.fetch.PinnedHTTPSConnection",
        lambda h, p, timeout=10: _FakeConn(h, p, timeout, lambda *_: _FakeResp(200, {"Content-Encoding": "gzip"}, bombGz)),
    ):
        with pytest.raises(fetch.FeedFetchError, match="Response too large"):
            fetch.fetchUrl("https://example.com/bomb", maxBytes=2048)


def test_wire_response_size_cap():
    with patch(
        "feeds.fetch.PinnedHTTPSConnection",
        lambda h, p, timeout=10: _FakeConn(h, p, timeout, lambda *_: _FakeResp(200, {}, b"x" * 5000)),
    ):
        with pytest.raises(fetch.FeedFetchError, match="Response too large"):
            fetch.fetchUrl("https://example.com/huge", maxBytes=1024)


def test_autodiscovery_prefers_rss_atom_json_and_resolves_relative_urls():
    html = b"""<!doctype html>
    <html><head>
      <link rel="alternate" type="application/json" href="/feed.json">
      <link rel="alternate" type="application/rss+xml; charset=utf-8" href="/rss.xml">
      <link rel="alternate" type="application/atom+xml" href="https://cdn.example.com/atom.xml">
      <link rel="stylesheet" href="/style.css">
    </head></html>"""
    urls = fetch.discoverFeedUrls(html, "https://site.example.com/blog/")
    assert urls == [
        "https://site.example.com/rss.xml",
        "https://cdn.example.com/atom.xml",
        "https://site.example.com/feed.json",
    ]


def test_fetch_and_discover_feed_from_homepage_html():
    html = b'<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>'
    rss = b'<?xml version="1.0"?><rss version="2.0"><channel><title>Discovered</title><item><guid>1</guid><title>Hi</title></item></channel></rss>'

    def responder(host, port, req):
        _, target, _ = req
        if target == "/feed.xml":
            return _FakeResp(200, {"Content-Type": "application/rss+xml"}, rss)
        return _FakeResp(200, {"Content-Type": "text/html"}, html)

    with patch("feeds.fetch.PinnedHTTPSConnection", lambda h, p, timeout=10: _FakeConn(h, p, timeout, responder)):
        finalUrl, parsed, _ = fetch.fetchAndDiscoverFeed("https://site.example.com/")

    assert finalUrl == "https://site.example.com/feed.xml"
    assert parsed.title == "Discovered"
    assert parsed.kind == "rss"
    assert len(parsed.items) == 1


def test_parse_feed_url_canonicalizes_host_case_and_default_port():
    u1, *_ = fetch.parseFeedUrl("https://EXAMPLE.COM:443/rss.xml")
    u2, *_ = fetch.parseFeedUrl("https://example.com/rss.xml")
    assert u1 == u2 == "https://example.com/rss.xml"


def test_slow_drip_response_respects_total_timeout_deadline():
    class _SlowSocket:
        def __init__(self):
            self.timeouts = []

        def settimeout(self, t):
            self.timeouts.append(t)

    class _SlowResp:
        status = 200

        def getheaders(self):
            return [("Content-Type", "application/xml")]

        def getheader(self, name, default=None):
            return "application/xml" if name.lower() == "content-type" else default

        def read(self, n=-1):
            # Sleep slightly longer than remaining budget across chunks
            import time as _t

            _t.sleep(0.08)
            return b"<rss/>"

    sock = _SlowSocket()

    class _SlowConn:
        def __init__(self, host, port, timeout=10):
            self.sock = sock

        def request(self, method, target, headers=None):
            pass

        def getresponse(self):
            return _SlowResp()

        def close(self):
            pass

    with patch("feeds.fetch.PinnedHTTPSConnection", _SlowConn):
        with pytest.raises(fetch.FeedFetchError, match="timed out"):
            fetch.fetchUrl("https://slow.example/rss", totalTimeout=0.12)

    assert sock.timeouts and all(t > 0 for t in sock.timeouts)


def test_fetch_and_discover_shares_total_timeout_budget():
    html = b'<html><head><link rel="alternate" type="application/rss+xml" href="/a.xml"><link rel="alternate" type="application/atom+xml" href="/b.xml"></head></html>'
    calls = []

    def fakeFetchUrl(url, *, totalTimeout=10.0, **kwargs):
        calls.append((url, totalTimeout))
        if url == "https://site.example/":
            import time as _t

            _t.sleep(0.08)
            return fetch.FetchResult(200, url, "text/html", html, None, None, False)
        raise fetch.FeedFetchError("fail")

    with patch("feeds.fetch.fetchUrl", side_effect=fakeFetchUrl):
        with pytest.raises(fetch.FeedDiscoveryError):
            fetch.fetchAndDiscoverFeed("https://site.example/", totalTimeout=0.5)

    assert len(calls) >= 2
    assert calls[1][1] < 0.45


def test_clean_header_val_caps_length_and_strips_control_chars():
    def badHeadersResp(host, port, req):
        return _FakeResp(
            200,
            {
                "Content-Type": "application/xml",
                "ETag": '"bad\r\nX-Injected: 1"',
                "Last-Modified": "x" * 600,
            },
            b"<rss/>",
        )

    with patch("feeds.fetch.PinnedHTTPSConnection", lambda h, p, timeout=10: _FakeConn(h, p, timeout, badHeadersResp)):
        res = fetch.fetchUrl("https://example.com/rss")

    assert res.etag is None
    assert res.lastModified is None


