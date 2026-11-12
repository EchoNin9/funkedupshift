"""Unit tests for the Email Auth Checker (src/lambda/tools/emailauth.py, GET /tools/emailauth).

dns.resolver.Resolver.resolve is patched at the class level, keyed on
(qname, rdtype) — no live network calls here.
"""
import base64
import json
import sys
from pathlib import Path
from unittest.mock import patch

import dns.exception
import dns.resolver

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Real keys generated once with the local openssl (genrsa N; rsa -pubout -outform DER;
# rsa -RSAPublicKey_out -outform DER), base64 of the DER.
SPKI512 = (
    "MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANLBQcIinqRGNQwqxx1qG/9HSjoFMk/lzYtcElYualoRdi7Tr6WGb0W8bNkJ4krwC2tJbAr30Uco91bWLqY/wlUCAwEAAQ=="
)
BARE512 = (
    "MEgCQQDSwUHCIp6kRjUMKscdahv/R0o6BTJP5c2LXBJWLmpaEXYu06+lhm9FvGzZCeJK8AtrSWwK99FHKPdW1i6mP8JVAgMBAAE="
)
SPKI1024 = (
    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC8hWWub6rg0S0RpLtlaPKoXOQdxt053oYmdLCju3ZjzKdO5oCVT7wtQla7I0HTTpw4mo0cFpV8zeuAhlk6fO2jrruNHaoweAQEsfykAaPvJUy07ULk68gCN18jOuu0nbcS10cR0y2j4hLsk7QIm6OYKVTpn/xfhHOUGwz8ib28FwIDAQAB"
)
BARE1024 = (
    "MIGJAoGBALyFZa5vquDRLRGku2Vo8qhc5B3G3TnehiZ0sKO7dmPMp07mgJVPvC1CVrsjQdNOnDiajRwWlXzN64CGWTp87aOuu40dqjB4BASx/KQBo+8lTLTtQuTryAI3XyM667SdtxLXRxHTLaPiEuyTtAibo5gpVOmf/F+Ec5QbDPyJvbwXAgMBAAE="
)
SPKI2048 = (
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApt7CEIa0hNww6ZjwIEQn6m2DDlOI79MQndKGY2lHNYH8AqG9aq8/uiycEU2+/BjfbZ7xsfMVYWowx59/afQdhnwB0ADo5N/QGbqn4i5ExYyzaYqKFwT7rheeBPo4RhJ1eRYuGC00zKo8jjcCSIzRGYpN271oWl4UoNh7EzXTlVuGF53sR/4wwp0FO9cO55h3Cx5HM0hHritCkZu6NoEEhLgm22yyaLqnCZn2oYkDE+mzGxNOj+rQEi7Va7/hZ+1G5X/dnSBonxIaPh/e1LAXTHmwSjTJPVGwbEdwDWEd6y7G65vYUEo/tru/z386CsZwIrTY5/EQZwY8JP93s+xe7wIDAQAB"
)
BARE2048 = (
    "MIIBCgKCAQEApt7CEIa0hNww6ZjwIEQn6m2DDlOI79MQndKGY2lHNYH8AqG9aq8/uiycEU2+/BjfbZ7xsfMVYWowx59/afQdhnwB0ADo5N/QGbqn4i5ExYyzaYqKFwT7rheeBPo4RhJ1eRYuGC00zKo8jjcCSIzRGYpN271oWl4UoNh7EzXTlVuGF53sR/4wwp0FO9cO55h3Cx5HM0hHritCkZu6NoEEhLgm22yyaLqnCZn2oYkDE+mzGxNOj+rQEi7Va7/hZ+1G5X/dnSBonxIaPh/e1LAXTHmwSjTJPVGwbEdwDWEd6y7G65vYUEo/tru/z386CsZwIrTY5/EQZwY8JP93s+xe7wIDAQAB"
)


def _event(query):
    return {
        "rawPath": "/tools/emailauth",
        "requestContext": {
            "http": {"method": "GET", "path": "/tools/emailauth"},
            "authorizer": {"jwt": {"claims": {"sub": "user-123", "email": "user@example.com"}}},
        },
        "headers": {},
        "queryStringParameters": query,
    }


class _TXT:
    def __init__(self, text, chunk=None):
        raw = text.encode()
        n = chunk or len(raw) or 1
        self.strings = tuple(raw[i:i + n] for i in range(0, len(raw), n)) or (b"",)


class _MX:
    def __init__(self, preference, exchange):
        self.preference = preference
        self.exchange = exchange


def _fake(table):
    """table: {(qname, rdtype): [str | rdata] | Exception}. Unknown keys -> NXDOMAIN."""
    def resolve(qname, rdtype, *a, **kw):
        v = table.get((str(qname), rdtype), dns.resolver.NXDOMAIN())
        if isinstance(v, Exception):
            raise v
        return [_TXT(x) if isinstance(x, str) else x for x in v]
    return resolve


def _run(table, domain="example.com", selectors=""):
    from tools import handler as h
    with patch.object(dns.resolver.Resolver, "resolve", side_effect=_fake(table)):
        resp = h.handler(_event({"domain": domain, "selectors": selectors}), None)
    assert resp["statusCode"] == 200, resp["body"]
    return json.loads(resp["body"])


def _sevs(body, sev):
    return [f["message"] for f in body["fixes"] if f["severity"] == sev]


def _dkim(key, k="rsa"):
    return [f"v=DKIM1; k={k}; p={key}"]


# --- handler ----------------------------------------------------------------


def test_handler_happy_path_and_shape():
    body = _run({("example.com", "TXT"): ["v=spf1 -all"]})
    assert set(body) == {"domain", "grade", "fixes", "spf", "dmarc", "dkim", "mx", "mtaSts", "tlsRpt", "bimi", "warnings"}
    assert body["domain"] == "example.com"
    # user selectors first, then defaults, deduped
    body = _run({}, selectors="foo,google")
    assert [d["selector"] for d in body["dkim"]][:3] == ["foo", "google", "selector1"]
    assert len(body["dkim"]) == 11


def test_handler_bad_input_400():
    from tools import handler as h
    for q in (
        {},
        {"domain": ""},
        {"domain": "bad domain!"},
        {"domain": "example.com", "selectors": ",".join(f"s{i}" for i in range(11))},
        {"domain": "example.com", "selectors": "bad selector"},
        {"domain": "example.com", "selectors": "-leading"},
    ):
        assert h.handler(_event(q), None)["statusCode"] == 400, q


# --- SPF ----------------------------------------------------------------------


def test_spf_include_tree_and_lookup_count():
    body = _run({
        ("example.com", "TXT"): ["v=spf1 include:_spf.google.com ~all"],
        ("_spf.google.com", "TXT"): ["v=spf1 ip4:1.2.3.4 -all"],
    })
    spf = body["spf"]
    assert spf["lookupCount"] == 1
    assert spf["all"] == "~"
    assert spf["tree"]["children"][0]["domain"] == "_spf.google.com"
    assert spf["tree"]["children"][0]["record"] == "v=spf1 ip4:1.2.3.4 -all"
    assert spf["tree"]["children"][0]["children"] == []
    assert not [m for m in _sevs(body, "high") if "SPF" in m]


def test_spf_split_character_strings_joined():
    table = {("example.com", "TXT"): [_TXT("v=spf1 include:_spf.google.com ip4:192.0.2.0/24 ~all", chunk=10)]}
    assert _run(table)["spf"]["record"] == "v=spf1 include:_spf.google.com ip4:192.0.2.0/24 ~all"


def test_spf_multiple_records_high():
    body = _run({("example.com", "TXT"): ["v=spf1 -all", "v=SPF1 ~all"]})
    assert body["spf"]["recordCount"] == 2
    assert any("multiple" in m.lower() for m in _sevs(body, "high"))


def test_spf_plus_all_high_and_question_all_medium():
    assert any("+all" in m for m in _sevs(_run({("example.com", "TXT"): ["v=spf1 +all"]}), "high"))
    body = _run({("example.com", "TXT"): ["v=spf1 ?all"]})
    assert any("?all" in m for m in _sevs(body, "medium"))
    body = _run({("example.com", "TXT"): ["v=spf1 ip4:1.2.3.4"]})
    assert any("no all" in m for m in _sevs(body, "medium"))


def test_spf_ptr_low():
    body = _run({("example.com", "TXT"): ["v=spf1 ptr -all"]})
    assert any("ptr" in m for m in _sevs(body, "low"))


def test_spf_eleven_lookups_high():
    inc = " ".join(f"include:i{n}.example.net" for n in range(11))
    table = {("example.com", "TXT"): [f"v=spf1 {inc} -all"]}
    table.update({(f"i{n}.example.net", "TXT"): ["v=spf1 -all"] for n in range(11)})
    body = _run(table)
    assert body["spf"]["lookupCount"] == 11
    assert any("limit: 11" in m for m in _sevs(body, "high"))


def test_spf_ip_and_all_not_counted_but_a_mx_redirect_are():
    table = {
        ("example.com", "TXT"): ["v=spf1 ip4:1.2.3.4 ip6:::1 a mx redirect=other.example"],
        ("other.example", "TXT"): ["v=spf1 -all"],
    }
    assert _run(table)["spf"]["lookupCount"] == 3


def test_spf_include_loop_no_infinite_recursion():
    body = _run({
        ("example.com", "TXT"): ["v=spf1 include:a.example -all"],
        ("a.example", "TXT"): ["v=spf1 include:b.example -all"],
        ("b.example", "TXT"): ["v=spf1 include:a.example -all"],
    })
    assert any("loop" in e for e in body["spf"]["errors"])
    assert any("loop" in m for m in _sevs(body, "high"))


def test_spf_missing_include_reported():
    body = _run({("example.com", "TXT"): ["v=spf1 include:gone.example -all"]})
    assert any("gone.example" in m for m in _sevs(body, "high"))


def test_spf_none_is_high():
    body = _run({})
    assert body["spf"]["present"] is False
    assert any("No SPF" in m for m in _sevs(body, "high"))


def test_spf_depth_limit_truncates():
    table = {("example.com", "TXT"): ["v=spf1 include:n1.x -all"]}
    for n in range(1, 30):
        table[(f"n{n}.x", "TXT")] = [f"v=spf1 include:n{n + 1}.x -all"]
    body = _run(table)
    assert any("truncated" in w for w in body["warnings"])


# --- DMARC ----------------------------------------------------------------------


def test_dmarc_missing_high():
    assert any("No DMARC" in m for m in _sevs(_run({}), "high"))


def test_dmarc_p_none_no_rua_two_mediums():
    body = _run({("_dmarc.example.com", "TXT"): ["v=DMARC1; p=none"]})
    med = [m for m in _sevs(body, "medium") if "DMARC" in m]
    assert len(med) == 2


def test_dmarc_full_policy_parsed():
    rec = "v=DMARC1; p=reject; sp=quarantine; pct=50; rua=mailto:a@example.com; ruf=mailto:f@example.com; adkim=s; aspf=r; fo=1"
    body = _run({("_dmarc.example.com", "TXT"): [rec]})
    t = body["dmarc"]["tags"]
    assert (t["p"], t["sp"], t["pct"], t["adkim"], t["aspf"], t["fo"]) == ("reject", "quarantine", "50", "s", "r", "1")
    assert t["rua"] == "mailto:a@example.com" and t["ruf"] == "mailto:f@example.com"
    assert any("pct=50" in m for m in _sevs(body, "low"))
    assert not [m for m in _sevs(body, "medium") if "DMARC" in m]


def test_dmarc_invalid_p_high():
    body = _run({("_dmarc.example.com", "TXT"): ["v=DMARC1; p=bogus; rua=mailto:a@example.com"]})
    assert any("invalid p=" in m for m in _sevs(body, "high"))


# --- DKIM -------------------------------------------------------------------------


def test_rsa_key_bits_spki_and_bare():
    from tools.emailauth import rsaKeyBits
    for const, bits in ((SPKI1024, 1024), (BARE1024, 1024), (SPKI2048, 2048), (BARE2048, 2048), (SPKI512, 512), (BARE512, 512)):
        assert rsaKeyBits(base64.b64decode(const)) == bits
    assert rsaKeyBits(b"garbage") is None


def test_dkim_1024_low_2048_clean_512_high():
    body = _run({
        ("s1._domainkey.example.com", "TXT"): _dkim(SPKI1024),
        ("s2._domainkey.example.com", "TXT"): _dkim(BARE2048),
        ("k1._domainkey.example.com", "TXT"): _dkim(SPKI512),
    })
    rows = {d["selector"]: d for d in body["dkim"]}
    assert rows["s1"]["keyBits"] == 1024 and rows["s2"]["keyBits"] == 2048 and rows["k1"]["keyBits"] == 512
    assert rows["s1"]["found"] and rows["s1"]["keyType"] == "rsa"
    assert any("s1" in m and "2048" in m for m in _sevs(body, "low"))
    assert any("k1" in m and "512" in m for m in _sevs(body, "high"))
    assert not any("selector s2" in m for m in _sevs(body, "low") + _sevs(body, "high"))


def test_dkim_revoked_and_ed25519():
    body = _run({
        ("s1._domainkey.example.com", "TXT"): ["v=DKIM1; k=rsa; p="],
        ("s2._domainkey.example.com", "TXT"): _dkim("11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=", k="ed25519"),
    })
    rows = {d["selector"]: d for d in body["dkim"]}
    assert rows["s1"]["found"] and rows["s1"]["keyBits"] is None
    assert any("revoked" in w for w in rows["s1"]["warnings"])
    assert rows["s2"]["keyType"] == "ed25519" and rows["s2"]["keyBits"] == 256


def test_dkim_none_found_medium():
    assert any("No DKIM" in m for m in _sevs(_run({}), "medium"))


def test_dkim_user_selector_queried():
    body = _run({("mysel._domainkey.example.com", "TXT"): _dkim(SPKI2048)}, selectors="mysel")
    assert body["dkim"][0]["selector"] == "mysel" and body["dkim"][0]["found"]
    assert not any("No DKIM" in m for m in _sevs(body, "medium"))


# --- MX / presence ---------------------------------------------------------------


def test_mx_sorted_by_preference():
    body = _run({("example.com", "MX"): [_MX(20, "b.example.com."), _MX(10, "a.example.com."), _MX(5, "z.example.com.")]})
    assert [(m["preference"], m["host"]) for m in body["mx"]] == [
        (5, "z.example.com"), (10, "a.example.com"), (20, "b.example.com")]


def test_mx_missing_medium_and_null_mx_ok():
    assert any("No MX" in m for m in _sevs(_run({}), "medium"))
    body = _run({("example.com", "MX"): [_MX(0, ".")]})
    assert body["mx"] == [{"preference": 0, "host": "."}]
    assert not any("No MX" in m for m in _sevs(body, "medium"))
    assert any("does not accept mail" in w for w in body["warnings"])


def test_presence_records():
    body = _run({
        ("_mta-sts.example.com", "TXT"): ["v=STSv1; id=1"],
        ("_smtp._tls.example.com", "TXT"): ["v=TLSRPTv1; rua=mailto:t@example.com"],
        ("default._bimi.example.com", "TXT"): ["v=BIMI1; l=https://example.com/l.svg"],
    })
    assert body["mtaSts"]["present"] and body["tlsRpt"]["present"] and body["bimi"]["present"]
    assert body["bimi"]["record"].startswith("v=BIMI1")
    assert not [m for m in _sevs(body, "low") if "MTA-STS" in m or "TLS-RPT" in m]
    assert [m for m in _sevs(_run({}), "low") if "MTA-STS" in m]


# --- timeouts / grade -------------------------------------------------------------


def test_timeout_still_returns_with_warning():
    body = _run({("example.com", "MX"): dns.exception.Timeout(), ("example.com", "TXT"): ["v=spf1 -all"]})
    assert any("MX" in w and "timed out" in w for w in body["warnings"])
    assert not any("No MX" in m for m in _sevs(body, "medium"))
    assert body["grade"] in "ABCDF"


def test_budget_exhausted_returns_partial():
    from tools import emailauth
    with patch.object(dns.resolver.Resolver, "resolve", side_effect=_fake({})):
        body = emailauth.lookup("example.com", [], budget=0)
    assert body["warnings"] and body["grade"] in "ABCDF"


def test_grade_good_domain_is_a():
    body = _run({
        ("example.com", "TXT"): ["v=spf1 include:_spf.google.com -all"],
        ("_spf.google.com", "TXT"): ["v=spf1 ip4:1.2.3.4 -all"],
        ("_dmarc.example.com", "TXT"): ["v=DMARC1; p=reject; rua=mailto:d@example.com"],
        ("google._domainkey.example.com", "TXT"): _dkim(SPKI2048),
        ("example.com", "MX"): [_MX(10, "mx.example.com.")],
        ("_mta-sts.example.com", "TXT"): ["v=STSv1; id=1"],
        ("_smtp._tls.example.com", "TXT"): ["v=TLSRPTv1; rua=mailto:t@example.com"],
    })
    assert body["fixes"] == []
    assert body["grade"] == "A"


def test_grade_nothing_is_f():
    body = _run({})
    assert body["grade"] == "F"
    sevs = [f["severity"] for f in body["fixes"]]
    assert sevs == sorted(sevs, key=["high", "medium", "low"].index)
