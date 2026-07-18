"""Unit tests for the DNS lookup tool (src/lambda/tools/handler.py, GET /tools/dns).

dns.resolver.Resolver.resolve is monkeypatched at the class level for every
test that exercises a real lookup — no live network calls here.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import dns.exception
import dns.resolver

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _event(query):
    return {
        "rawPath": "/tools/dns",
        "requestContext": {
            "http": {"method": "GET", "path": "/tools/dns"},
            "authorizer": {"jwt": {"claims": {"sub": "user-123", "email": "user@example.com"}}},
        },
        "headers": {},
        "queryStringParameters": query,
    }


class _FakeRR:
    def __init__(self, text):
        self._text = text

    def to_text(self):
        return self._text


class _FakeRRset:
    def __init__(self, ttl):
        self.ttl = ttl


class _FakeAnswer:
    """Minimal stand-in for a dns.resolver.Answer — iterable rrs + rrset.ttl."""

    def __init__(self, values, ttl):
        self._values = [_FakeRR(v) for v in values]
        self.rrset = _FakeRRset(ttl)

    def __iter__(self):
        return iter(self._values)


# --- happy path --------------------------------------------------------


def test_a_record_happy_path_returns_records_and_ttl():
    from tools import handler as tools_handler

    fake_answer = _FakeAnswer(["93.184.216.34"], 300)
    with patch.object(dns.resolver.Resolver, "resolve", return_value=fake_answer) as mock_resolve:
        result = tools_handler.handler(_event({"name": "example.com", "type": "A"}), None)

    assert result["statusCode"] == 200
    import json

    body = json.loads(result["body"])
    assert body["name"] == "example.com"
    assert body["type"] == "A"
    assert body["status"] == "ok"
    assert body["records"] == [{"record": "A", "ttl": 300, "value": "93.184.216.34"}]
    # query issued with the normalized name and the requested type
    args, _ = mock_resolve.call_args
    assert args[0] == "example.com"
    assert args[1] == "A"


def test_mx_record_multiple_values_share_the_rrset_ttl():
    from tools import handler as tools_handler

    fake_answer = _FakeAnswer(["10 mail.example.com.", "20 mail2.example.com."], 300)
    with patch.object(dns.resolver.Resolver, "resolve", return_value=fake_answer):
        result = tools_handler.handler(_event({"name": "example.com", "type": "MX"}), None)

    import json

    body = json.loads(result["body"])
    assert body["status"] == "ok"
    assert body["records"] == [
        {"record": "MX", "ttl": 300, "value": "10 mail.example.com."},
        {"record": "MX", "ttl": 300, "value": "20 mail2.example.com."},
    ]


# --- status mapping ------------------------------------------------------


def test_nxdomain_returns_200_with_nxdomain_status():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=dns.resolver.NXDOMAIN()):
        result = tools_handler.handler(_event({"name": "definitely-not-a-real-domain.invalid", "type": "A"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["status"] == "nxdomain"
    assert body["records"] == []


def test_noanswer_returns_200_with_noanswer_status():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=dns.resolver.NoAnswer()):
        result = tools_handler.handler(_event({"name": "example.com", "type": "AAAA"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["status"] == "noanswer"
    assert body["records"] == []


def test_timeout_returns_200_with_timeout_status():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=dns.exception.Timeout()):
        result = tools_handler.handler(_event({"name": "example.com", "type": "A"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["status"] == "timeout"
    assert body["records"] == []


def test_nonameservers_returns_200_with_servfail_status():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=dns.resolver.NoNameservers()):
        result = tools_handler.handler(_event({"name": "dnssec-failed.org", "type": "A"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["status"] == "servfail"
    assert body["records"] == []


# --- validation (no DNS call should ever happen on these) ----------------


def test_invalid_domain_chars_returns_400_without_calling_resolver():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve") as mock_resolve:
        result = tools_handler.handler(_event({"name": "exa mple!.com", "type": "A"}), None)

    assert result["statusCode"] == 400
    mock_resolve.assert_not_called()


def test_bad_type_returns_400():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event({"name": "example.com", "type": "ZZZZ"}), None)
    assert result["statusCode"] == 400


def test_missing_type_returns_400():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event({"name": "example.com"}), None)
    assert result["statusCode"] == 400


def test_missing_name_returns_400():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event({"type": "A"}), None)
    assert result["statusCode"] == 400


def test_label_too_long_returns_400():
    from tools import handler as tools_handler

    label = "a" * 64  # max is 63
    result = tools_handler.handler(_event({"name": f"{label}.com", "type": "A"}), None)
    assert result["statusCode"] == 400


def test_name_too_long_returns_400():
    from tools import handler as tools_handler

    # 254 chars total, well past the 253 limit, built from valid-length labels
    name = ".".join(["a" * 50] * 5) + ".com"
    result = tools_handler.handler(_event({"name": name, "type": "A"}), None)
    assert result["statusCode"] == 400


def test_empty_label_returns_400():
    from tools import handler as tools_handler

    result = tools_handler.handler(_event({"name": "example..com", "type": "A"}), None)
    assert result["statusCode"] == 400


def test_trailing_dot_is_stripped_and_accepted():
    from tools import handler as tools_handler

    fake_answer = _FakeAnswer(["93.184.216.34"], 60)
    with patch.object(dns.resolver.Resolver, "resolve", return_value=fake_answer):
        result = tools_handler.handler(_event({"name": "example.com.", "type": "A"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["name"] == "example.com"


# --- PTR ------------------------------------------------------------------


def test_ptr_with_valid_ip_uses_reversename():
    from tools import handler as tools_handler

    fake_answer = _FakeAnswer(["dns.google."], 3600)
    with patch("dns.reversename.from_address", wraps=__import__("dns.reversename", fromlist=["from_address"]).from_address) as mock_reversename, \
         patch.object(dns.resolver.Resolver, "resolve", return_value=fake_answer) as mock_resolve:
        result = tools_handler.handler(_event({"name": "8.8.8.8", "type": "PTR"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["name"] == "8.8.8.8"
    assert body["type"] == "PTR"
    assert body["status"] == "ok"
    assert body["records"] == [{"record": "PTR", "ttl": 3600, "value": "dns.google."}]
    mock_reversename.assert_called_once_with("8.8.8.8")
    # the resolved query name passed to resolve() is the reverse-mapped name, not the raw IP
    args, _ = mock_resolve.call_args
    assert str(args[0]) == "8.8.8.8.in-addr.arpa."
    assert args[1] == "PTR"


def test_ptr_with_non_ip_returns_400_without_calling_resolver():
    from tools import handler as tools_handler

    with patch.object(dns.resolver.Resolver, "resolve") as mock_resolve:
        result = tools_handler.handler(_event({"name": "not-an-ip", "type": "PTR"}), None)

    assert result["statusCode"] == 400
    mock_resolve.assert_not_called()


def test_ptr_with_ipv6_address_uses_reversename():
    from tools import handler as tools_handler

    fake_answer = _FakeAnswer(["dns.google."], 3600)
    with patch.object(dns.resolver.Resolver, "resolve", return_value=fake_answer) as mock_resolve:
        result = tools_handler.handler(_event({"name": "2001:4860:4860::8888", "type": "PTR"}), None)

    import json

    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["name"] == "2001:4860:4860::8888"
    args, _ = mock_resolve.call_args
    assert args[1] == "PTR"


def test_route_not_found_for_other_paths():
    from tools import handler as tools_handler

    result = tools_handler.handler(
        {
            "rawPath": "/tools/dns-nope",
            "requestContext": {"http": {"method": "GET", "path": "/tools/dns-nope"}},
        },
        None,
    )
    assert result["statusCode"] == 404
