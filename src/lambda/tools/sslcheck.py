"""SSL Certificate Checker (FUNK-73): GET /tools/ssl?host=<h>&port=<p>.

Connects to exactly the IPv4 address common.netguard.public_ip validated (SSRF
guard), does a TLS handshake with SNI, and parses the presented chain with the
`cryptography` package.

check() returns:
  {"host", "port", "ip", "status": "ok"|"warning"|"error",
   "trusted": bool, "trustError": str|None, "hostnameMatch": bool,
   "tlsVersion": str, "cipher": str, "daysLeft": int,
   "chain": [{"subject", "issuer", "sans": {"dns": [..], "ip": [..]}, "serial",
              "signatureHash", "keyType", "keySize", "notBefore", "notAfter",
              "selfSigned"}]}      # leaf first
and raises SslCheckError(message) for anything the caller should show as a 400.
"""
import ipaddress
import socket
import ssl
import time
from datetime import datetime, timezone

from common.netguard import public_ip

ALLOWED_PORTS = (443, 465, 636, 853, 990, 993, 995, 5061, 8443)
DEFAULT_PORT = 443
# Each handshake gets its own 5 s; the untrusted path does two, so worst case ~10 s,
# still under the tools Lambda's 15 s timeout. A shared budget timed out on slow hosts.
HANDSHAKE_BUDGET_SEC = 5.0
WARN_DAYS = 30


class SslCheckError(Exception):
    pass


def parsePort(raw):
    """Return (port, error)."""
    if raw is None or str(raw).strip() == "":
        return DEFAULT_PORT, None
    try:
        port = int(str(raw).strip())
    except ValueError:
        port = None
    if port not in ALLOWED_PORTS:
        return None, "port must be one of: " + ", ".join(str(p) for p in ALLOWED_PORTS)
    return port, None


def hostnameMatches(host, dns_names, ip_names=()):
    """RFC 6125 matching: `*` only as the whole left-most label, matching exactly one label."""
    host = host.lower().rstrip(".")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        return any(ipaddress.ip_address(i) == ip for i in ip_names)
    hl = host.split(".")
    for pat in dns_names:
        pl = pat.lower().rstrip(".").split(".")
        if len(pl) != len(hl):
            continue
        if pl[0] == "*":
            if len(pl) >= 3 and pl[1:] == hl[1:]:  # no bare `*.tld` wildcards
                return True
        elif pl == hl:
            return True
    return False


def _keyInfo(pub):
    from cryptography.hazmat.primitives.asymmetric import ec, ed448, ed25519, rsa
    if isinstance(pub, rsa.RSAPublicKey):
        return "RSA", pub.key_size
    if isinstance(pub, ec.EllipticCurvePublicKey):
        return "EC " + pub.curve.name, pub.key_size
    if isinstance(pub, ed25519.Ed25519PublicKey):
        return "Ed25519", 256
    if isinstance(pub, ed448.Ed448PublicKey):
        return "Ed448", 456
    return type(pub).__name__, None


def parseCert(der):
    from cryptography import x509
    cert = x509.load_der_x509_certificate(der)
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        dns_names = san.get_values_for_type(x509.DNSName)
        ip_names = [str(i) for i in san.get_values_for_type(x509.IPAddress)]
    except x509.ExtensionNotFound:
        dns_names, ip_names = [], []
    keyType, keySize = _keyInfo(cert.public_key())
    h = cert.signature_hash_algorithm
    subject, issuer = cert.subject.rfc4514_string(), cert.issuer.rfc4514_string()
    return {
        "subject": subject,
        "issuer": issuer,
        "sans": {"dns": dns_names, "ip": ip_names},
        "serial": format(cert.serial_number, "x"),
        "signatureHash": h.name if h else None,
        "keyType": keyType,
        "keySize": keySize,
        "notBefore": cert.not_valid_before_utc.isoformat(),
        "notAfter": cert.not_valid_after_utc.isoformat(),
        "selfSigned": subject == issuer,
    }


def _daysLeft(not_after_iso, now=None):
    now = now or datetime.now(timezone.utc)
    return (datetime.fromisoformat(not_after_iso) - now).days


def computeStatus(trusted, hostname_match, days_left):
    if not trusted or not hostname_match or days_left < 0:
        return "error"
    return "warning" if days_left <= WARN_DAYS else "ok"


def _connect(host, port, context, deadline):
    """One TCP+TLS connection to the validated IP. Returns (sslsock, ip)."""
    try:
        ip = public_ip(host, port)
    except ValueError as e:
        msg = str(e)
        if msg == "Could not resolve host":
            try:
                v6 = socket.getaddrinfo(host, port, family=socket.AF_INET6, type=socket.SOCK_STREAM)
            except socket.gaierror:
                v6 = []
            msg = "Host has no IPv4 address (IPv6-only hosts are not supported)" if v6 else "Could not resolve host"
        elif msg == "URL points to a non-public address":
            msg = "Host resolves to a non-public address"
        raise SslCheckError(msg)
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise SslCheckError("Timed out connecting to host")
    sock = socket.create_connection((ip, port), remaining)
    try:
        sock.settimeout(max(deadline - time.monotonic(), 0.1))
        return context.wrap_socket(sock, server_hostname=host), ip
    except BaseException:
        sock.close()
        raise


def _chainDer(s, verified):
    getter = getattr(s, "get_verified_chain" if verified else "get_unverified_chain", None)
    if getter:
        chain = getter()
        if chain:
            return [c if isinstance(c, bytes) else ssl.PEM_cert_to_DER_cert(c.public_bytes()) for c in chain]
    # ponytail: Python < 3.13 (CI's 3.12) has no chain accessor; leaf only. Lambda is 3.13.
    leaf = s.getpeercert(binary_form=True)
    return [leaf] if leaf else []


def _handshake(host, port, context, deadline, verified):
    s, ip = _connect(host, port, context, deadline)
    try:
        return ip, _chainDer(s, verified), s.version(), (s.cipher() or ("",))[0]
    finally:
        s.close()


def check(host, port=DEFAULT_PORT):
    deadline = time.monotonic() + HANDSHAKE_BUDGET_SEC
    trusted, trust_error = True, None
    try:
        try:
            ip, ders, version, cipher = _handshake(host, port, ssl.create_default_context(), deadline, True)
        except ssl.SSLCertVerificationError as e:
            trusted, trust_error = False, e.verify_message or "certificate verification failed"
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            ip, ders, version, cipher = _handshake(host, port, ctx, time.monotonic() + HANDSHAKE_BUDGET_SEC, False)
    except SslCheckError:
        raise
    except ConnectionRefusedError:
        raise SslCheckError("Connection refused")
    except (socket.timeout, TimeoutError):
        raise SslCheckError("Timed out connecting to host")
    except socket.gaierror:
        raise SslCheckError("Could not resolve host")
    except ssl.SSLError as e:
        raise SslCheckError("TLS handshake failed: " + (getattr(e, "reason", None) or "unsupported or no TLS on this port"))
    except OSError as e:
        raise SslCheckError("Connection failed: " + (e.strerror or "network error"))
    if not ders:
        raise SslCheckError("Server presented no certificate")
    chain = [parseCert(d) for d in ders]
    leaf = chain[0]
    match = hostnameMatches(host, leaf["sans"]["dns"], leaf["sans"]["ip"])
    days = _daysLeft(leaf["notAfter"])
    return {
        "host": host, "port": port, "ip": ip,
        "status": computeStatus(trusted, match, days),
        "trusted": trusted, "trustError": trust_error,
        "hostnameMatch": match,
        "tlsVersion": version, "cipher": cipher,
        "daysLeft": days,
        "chain": chain,
    }
