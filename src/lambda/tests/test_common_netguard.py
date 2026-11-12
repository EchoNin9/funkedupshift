"""Unit tests for common.netguard (SSRF-safe, IP-pinned fetch)."""
import io
import socket
import sys
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from common import netguard as ng  # noqa: E402


# --- safe_fetch ---

class _FakeSock:
    """Just enough socket for http.client to read a canned response."""
    def __init__(self, response):
        self.response = response

    def sendall(self, data):
        pass

    def makefile(self, *a, **k):
        return io.BytesIO(self.response)

    def close(self):
        pass

    def settimeout(self, t):
        pass


def _http(status, body=b"", headers=""):
    return (f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\n{headers}\r\n").encode() + body


HOSTS = {"public.example": "93.184.216.34", "other.example": "93.184.216.35", "evil.example": "10.0.0.5"}


def _resolve(host, port, **kw):
    ip = HOSTS.get(host, host)
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]


def _net(responses):
    """Patch DNS (HOSTS) and create_connection (serves `responses` in order). Returns (resolver, connect) mocks."""
    queue = list(responses)
    return (
        patch("socket.getaddrinfo", side_effect=_resolve),
        patch("socket.create_connection", side_effect=lambda *a, **k: _FakeSock(queue.pop(0))),
    )


def test_safe_fetch_connects_to_the_validated_ip_not_the_hostname():
    dns, conn = _net([_http("200 OK", b"hello", "Content-Type: text/plain; charset=utf-8\r\n")])
    with dns, conn as connect:
        data, ctype, final = ng.safe_fetch("http://public.example/x", 100, 5)
    assert connect.call_args.args[0] == ("93.184.216.34", 80)
    assert (data, ctype, final) == (b"hello", "text/plain", "http://public.example/x")


def test_safe_fetch_rebinding_second_answer_is_never_connected_to():
    answers = [_resolve("public.example", 80), _resolve("evil.example", 80)]
    with patch("socket.getaddrinfo", side_effect=lambda *a, **k: answers.pop(0)) as dns, \
            patch("socket.create_connection", side_effect=lambda *a, **k: _FakeSock(_http("200 OK", b"ok"))) as connect:
        ng.safe_fetch("http://public.example/", 100, 5)
    assert dns.call_count == 1  # one resolution per connection, and it is the one we connect to
    assert [c.args[0][0] for c in connect.call_args_list] == ["93.184.216.34"]


def test_safe_fetch_refuses_mixed_public_and_private_answer():
    mixed = _resolve("a", 80) + [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 80))]
    with patch("socket.getaddrinfo", return_value=mixed), patch("socket.create_connection") as connect:
        with pytest.raises(ValueError):
            ng.safe_fetch("http://a.example/", 100, 5)
    connect.assert_not_called()


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://169.254.169.254/", "http://10.0.0.5/", "http://100.64.0.1/", "http://0.0.0.0/",
    "http://2130706433/", "http://[::1]/", "http://[::ffff:10.0.0.1]/", "http://localhost/",
    "file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/",
])
def test_safe_fetch_refuses_before_connecting(url):
    with patch("socket.create_connection") as connect:
        with pytest.raises(ValueError):
            ng.safe_fetch(url, 100, 5)
    connect.assert_not_called()


def test_safe_fetch_follows_redirects_and_pins_each_hop():
    dns, conn = _net([
        _http("301 Moved", b"", "Location: https://other.example/y\r\n"),
        _http("200 OK", b"done"),
    ])
    with dns, conn as connect, patch.object(ng._TLS, "wrap_socket", side_effect=lambda sock, server_hostname: sock) as wrap:
        data, _, final = ng.safe_fetch("http://public.example/x", 100, 5)
    assert data == b"done" and final == "https://other.example/y"
    assert [c.args[0] for c in connect.call_args_list] == [("93.184.216.34", 80), ("93.184.216.35", 443)]
    assert wrap.call_args.kwargs["server_hostname"] == "other.example"  # cert is verified against the real name


def test_safe_fetch_redirect_to_private_address_is_refused():
    dns, conn = _net([_http("302 Found", b"", "Location: http://evil.example/\r\n")])
    with dns, conn as connect:
        with pytest.raises(ValueError):
            ng.safe_fetch("http://public.example/", 100, 5)
    assert [c.args[0][0] for c in connect.call_args_list] == ["93.184.216.34"]  # evil host never connected


@pytest.mark.parametrize("target", ["file:///etc/passwd", "ftp://other.example/x", "gopher://other.example/"])
def test_safe_fetch_redirect_to_non_http_scheme_is_refused(target):
    dns, conn = _net([_http("302 Found", b"", f"Location: {target}\r\n")])
    with dns, conn as connect:
        with pytest.raises(ValueError):
            ng.safe_fetch("http://public.example/", 100, 5)
    assert connect.call_count == 1


def test_safe_fetch_redirect_loop_is_capped():
    dns, conn = _net([_http("302 Found", b"", "Location: http://public.example/\r\n")] * 10)
    with dns, conn as connect:
        with pytest.raises(urllib.error.HTTPError):
            ng.safe_fetch("http://public.example/", 100, 5)
    assert connect.call_count <= 6


def test_safe_fetch_plain_404_raises_httperror():
    dns, conn = _net([_http("404 Not Found")])
    with dns, conn:
        with pytest.raises(urllib.error.HTTPError) as e:
            ng.safe_fetch("http://public.example/", 100, 5)
    assert e.value.code == 404


def test_safe_fetch_valueerror_from_connect_surfaces_as_valueerror():
    with patch.object(ng, "public_ip", side_effect=ValueError("boom")):
        with pytest.raises(ValueError, match="boom"):
            ng.safe_fetch("http://public.example/", 100, 5)


def test_safe_fetch_enforces_max_bytes():
    for body, ok in ((b"x" * 11, False), (b"x" * 10, True)):
        dns, conn = _net([_http("200 OK", body)])
        with dns, conn:
            if ok:
                assert ng.safe_fetch("http://public.example", 10, 5)[0] == body
            else:
                with pytest.raises(ValueError):
                    ng.safe_fetch("http://public.example/", 10, 5)
