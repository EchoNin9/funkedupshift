"""Unit tests for the SSL Certificate Checker (src/lambda/tools/sslcheck.py, GET /tools/ssl).

No network: socket.getaddrinfo / create_connection and the SSL context are patched; certificates are
generated here with the cryptography library.
"""
import json
import socket
import ssl
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import handler as th  # noqa: E402
from tools import sslcheck  # noqa: E402


def _event(query):
    return {
        "rawPath": "/tools/ssl",
        "requestContext": {"http": {"method": "GET", "path": "/tools/ssl"}},
        "queryStringParameters": query,
    }


def _call(query):
    r = th.handler(_event(query), None)
    return r["statusCode"], json.loads(r["body"])


def _make_cert(cn="example.test", sans=("example.test", "*.example.test"), key=None, issuer_cn=None,
               days_valid=90, not_before=None, ips=()):
    key = key or rsa.generate_private_key(public_exponent=65537, key_size=2048)
    nb = not_before or datetime.now(timezone.utc) - timedelta(days=1)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, issuer_cn or "Test CA")])
    b = (x509.CertificateBuilder().subject_name(name).issuer_name(issuer).public_key(key.public_key())
         .serial_number(0xABC123).not_valid_before(nb).not_valid_after(nb + timedelta(days=days_valid)))
    alt = [x509.DNSName(s) for s in sans] + [x509.IPAddress(__import__("ipaddress").ip_address(i)) for i in ips]
    if alt:
        b = b.add_extension(x509.SubjectAlternativeName(alt), critical=False)
    return b.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)


# ---- hostname matching ----

def test_wildcard_matches_one_label_only():
    assert sslcheck.hostnameMatches("a.example.test", ["*.example.test"])
    assert not sslcheck.hostnameMatches("a.b.example.test", ["*.example.test"])
    assert not sslcheck.hostnameMatches("example.test", ["*.example.test"])
    assert sslcheck.hostnameMatches("example.test", ["*.example.test", "example.test"])


def test_hostname_match_case_insensitive_and_ip():
    assert sslcheck.hostnameMatches("A.Example.TEST", ["*.EXAMPLE.test"])
    assert sslcheck.hostnameMatches("93.184.216.34", [], ["93.184.216.34"])
    assert not sslcheck.hostnameMatches("93.184.216.34", ["93.184.216.34"], [])


def test_wildcard_only_as_whole_leftmost_label():
    assert not sslcheck.hostnameMatches("ab.example.test", ["a*.example.test"])
    assert not sslcheck.hostnameMatches("a.example.test", ["a.*.test"])
    assert not sslcheck.hostnameMatches("com", ["*"])
    assert not sslcheck.hostnameMatches("example.com", ["*.com"])


# ---- certificate parsing ----

def test_parse_rsa_leaf():
    c = sslcheck.parseCert(_make_cert())
    assert c["subject"] == "CN=example.test" and c["issuer"] == "CN=Test CA"
    assert c["sans"]["dns"] == ["example.test", "*.example.test"] and c["sans"]["ip"] == []
    assert (c["keyType"], c["keySize"]) == ("RSA", 2048)
    assert c["signatureHash"] == "sha256" and c["serial"] == "abc123"
    assert c["selfSigned"] is False
    assert c["notAfter"].endswith("+00:00")
    assert 88 <= sslcheck._daysLeft(c["notAfter"]) <= 90


def test_parse_self_signed_ec_with_ip_san():
    der = _make_cert(cn="self.test", sans=(), issuer_cn="self.test", key=ec.generate_private_key(ec.SECP256R1()),
                     ips=("203.0.113.7",))
    c = sslcheck.parseCert(der)
    assert c["selfSigned"] is True
    assert (c["keyType"], c["keySize"]) == ("EC secp256r1", 256)
    assert c["sans"] == {"dns": [], "ip": ["203.0.113.7"]}


def test_parse_expired_cert_has_negative_days():
    der = _make_cert(days_valid=10, not_before=datetime.now(timezone.utc) - timedelta(days=100))
    assert sslcheck._daysLeft(sslcheck.parseCert(der)["notAfter"]) < 0


# ---- status ----

def test_status_matrix():
    assert sslcheck.computeStatus(True, True, 90) == "ok"
    assert sslcheck.computeStatus(True, True, 31) == "ok"
    assert sslcheck.computeStatus(True, True, 30) == "warning"
    assert sslcheck.computeStatus(True, True, 10) == "warning"
    assert sslcheck.computeStatus(True, True, -1) == "error"
    assert sslcheck.computeStatus(False, True, 90) == "error"
    assert sslcheck.computeStatus(True, False, 90) == "error"


# ---- connection mocking ----

def _fake_tls(der_chain, version="TLSv1.3", cipher="TLS_AES_128_GCM_SHA256"):
    s = MagicMock()
    s.get_verified_chain.return_value = der_chain
    s.get_unverified_chain.return_value = der_chain
    s.getpeercert.return_value = der_chain[0]
    s.version.return_value = version
    s.cipher.return_value = (cipher, version, 128)
    return s


def _public_dns(ip="93.184.216.34"):
    return patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))])


def _ctx_patch(contexts):
    """Patch ssl.create_default_context to hand out mock contexts in order."""
    return patch("ssl.create_default_context", side_effect=contexts)


def test_ok_path():
    der = _make_cert()
    ctx = MagicMock()
    ctx.wrap_socket.return_value = _fake_tls([der])
    with _public_dns(), patch("socket.create_connection") as cc, _ctx_patch([ctx]):
        code, body = _call({"host": "example.test"})
    assert code == 200
    assert body["status"] == "ok" and body["trusted"] is True and body["hostnameMatch"] is True
    assert body["tlsVersion"] == "TLSv1.3" and body["cipher"] == "TLS_AES_128_GCM_SHA256"
    assert body["port"] == 443 and len(body["chain"]) == 1
    assert cc.call_args.args[0] == ("93.184.216.34", 443)  # the IP, not the hostname
    assert ctx.wrap_socket.call_args.kwargs["server_hostname"] == "example.test"


def test_untrusted_then_unverified_reconnect():
    der = _make_cert(cn="self.test", sans=("self.test",), issuer_cn="self.test")
    strict, loose = MagicMock(), MagicMock()
    err = ssl.SSLCertVerificationError(1, "[SSL: CERTIFICATE_VERIFY_FAILED] self-signed certificate")
    err.verify_message = "self-signed certificate"
    strict.wrap_socket.side_effect = err
    loose.wrap_socket.return_value = _fake_tls([der])
    with _public_dns(), patch("socket.create_connection") as cc, _ctx_patch([strict, loose]):
        code, body = _call({"host": "self.test"})
    assert code == 200 and cc.call_count == 2
    assert body["status"] == "error" and body["trusted"] is False
    assert body["trustError"] == "self-signed certificate"
    assert body["hostnameMatch"] is True and body["chain"][0]["selfSigned"] is True
    assert loose.check_hostname is False and loose.verify_mode == ssl.CERT_NONE
    loose.wrap_socket.return_value.get_unverified_chain.assert_called()


def test_hostname_mismatch_reported_independently_of_trust():
    der = _make_cert()
    ctx = MagicMock()
    ctx.wrap_socket.return_value = _fake_tls([der])
    with _public_dns(), patch("socket.create_connection"), _ctx_patch([ctx]):
        code, body = _call({"host": "other.test"})
    assert body["hostnameMatch"] is False and body["status"] == "error" and body["trusted"] is True


def test_warning_and_expired_via_check():
    for days, nb_days_ago, want in ((10, 1, "warning"), (10, 100, "error")):
        der = _make_cert(days_valid=days + nb_days_ago - 1 if want == "warning" else days,
                         not_before=datetime.now(timezone.utc) - timedelta(days=nb_days_ago))
        ctx = MagicMock()
        ctx.wrap_socket.return_value = _fake_tls([der])
        with _public_dns(), patch("socket.create_connection"), _ctx_patch([ctx]):
            assert _call({"host": "example.test"})[1]["status"] == want


def test_leaf_only_fallback_without_chain_methods():
    der = _make_cert()
    s = MagicMock(spec=["getpeercert", "version", "cipher", "close"])
    s.getpeercert.return_value = der
    s.version.return_value = "TLSv1.2"
    s.cipher.return_value = ("X", "TLSv1.2", 128)
    ctx = MagicMock()
    ctx.wrap_socket.return_value = s
    with _public_dns(), patch("socket.create_connection"), _ctx_patch([ctx]):
        code, body = _call({"host": "example.test"})
    assert code == 200 and len(body["chain"]) == 1


# ---- input validation ----

def test_missing_and_bad_host():
    assert _call({})[0] == 400
    assert _call({"host": "bad host!"})[0] == 400
    assert _call(None)[0] == 400


def test_bad_port_lists_allowed():
    code, body = _call({"host": "example.test", "port": "22"})
    assert code == 400 and "443" in body["error"] and "8443" in body["error"]
    assert _call({"host": "example.test", "port": "abc"})[0] == 400


# ---- SSRF ----

@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.5", "169.254.169.254", "100.64.0.1"])
def test_non_public_answers_refused_without_connecting(ip):
    with _public_dns(ip), patch("socket.create_connection") as cc:
        code, body = _call({"host": "evil.test"})
    assert code == 400 and "non-public" in body["error"]
    cc.assert_not_called()


def test_private_ipv4_literal_refused():
    with patch("socket.create_connection") as cc:
        assert _call({"host": "10.1.2.3"})[0] == 400
        assert _call({"host": "127.0.0.1"})[0] == 400
    cc.assert_not_called()


def test_ipv6_only_host_gets_clear_error():
    def gai(host, port, family=0, type=0, **k):
        if family == socket.AF_INET:
            raise socket.gaierror
        return [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:db8::1", port, 0, 0))]
    with patch("socket.getaddrinfo", side_effect=gai), patch("socket.create_connection") as cc:
        code, body = _call({"host": "v6.test"})
    assert code == 400 and "no IPv4" in body["error"]
    cc.assert_not_called()


def test_resolution_failure():
    with patch("socket.getaddrinfo", side_effect=socket.gaierror):
        code, body = _call({"host": "nope.test"})
    assert code == 400 and "resolve" in body["error"]


# ---- connection errors ----

@pytest.mark.parametrize("exc,text", [
    (ConnectionRefusedError(), "refused"),
    (socket.timeout(), "Timed out"),
])
def test_connect_errors_are_400(exc, text):
    with _public_dns(), patch("socket.create_connection", side_effect=exc):
        code, body = _call({"host": "example.test"})
    assert code == 400 and text in body["error"]


def test_handshake_failure_is_400():
    ctx = MagicMock()
    ctx.wrap_socket.side_effect = ssl.SSLError(1, "[SSL] wrong version number")
    with _public_dns(), patch("socket.create_connection"), _ctx_patch([ctx]):
        code, body = _call({"host": "example.test"})
    assert code == 400 and "handshake failed" in body["error"]
