"""Email Auth Checker (FUNK-75): SPF / DKIM / DMARC / MX / MTA-STS / TLS-RPT / BIMI.

Pure parsing + grading functions and the lookup orchestration, kept out of
handler.py. dnspython only; DKIM key length is read with a minimal stdlib DER
reader. No outbound HTTP (MTA-STS / BIMI are presence-only).

Response shape of lookup():
  {
    "domain": str,
    "grade": "A"|"B"|"C"|"D"|"F",
    "fixes": [{"severity": "high"|"medium"|"low", "message": str}],  # high first
    "spf": {"present": bool, "record": str|None, "recordCount": int,
            "mechanisms": [{"qualifier": str, "mechanism": str, "value": str}],
            "modifiers": [{"name": str, "value": str}],
            "all": str|None,              # qualifier of the `all` term
            "lookupCount": int,           # RFC 7208 4.6.4 DNS-lookup terms, whole tree
            "tree": node|None, "errors": [str], "notes": [str]},
        node = {"domain", "via": "include"|"redirect"|None, "record": str|None,
                "error": str|None, "children": [node]}
    "dmarc": {"present", "record", "tags": {name: value}, "error": str|None},
    "dkim": [{"selector", "found", "keyType", "keyBits", "warnings": [str]}],
    "mx": [{"preference": int, "host": str}],   # host "." is a null MX
    "mtaSts": {"present", "record"}, "tlsRpt": {...}, "bimi": {...},
    "warnings": [str],                          # timeouts / truncation, never a 500
  }
"""
import base64
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait

BUDGET_SECONDS = 10.0
QUERY_LIFETIME = 3.0  # google.com-sized TXT sets take ~2s via UDP->TCP fallback
MAX_WORKERS = 8
SPF_MAX_DEPTH = 10
SPF_MAX_TXT_QUERIES = 40
SPF_LOOKUP_LIMIT = 10
MAX_SELECTORS = 10

DEFAULT_SELECTORS = ["google", "selector1", "selector2", "default", "k1", "k2", "s1", "s2", "dkim", "mail"]
_SELECTOR_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
_MODIFIER_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_.-]*)=(.*)$")
_LOOKUP_TERMS = {"include", "a", "mx", "ptr", "exists"}


def parseSelectors(raw):
    """Parse the optional comma list. Returns (selectors, error)."""
    if not raw:
        return [], None
    items = [s.strip() for s in raw.split(",") if s.strip()]
    if len(items) > MAX_SELECTORS:
        return None, f"at most {MAX_SELECTORS} selectors are allowed"
    if any(not _SELECTOR_RE.match(s) for s in items):
        return None, "selectors may only contain letters, digits, '.', '_' and '-'"
    return items, None


# --- DNS plumbing ---------------------------------------------------------


class _Ctx:
    """Shared per-lookup state: deadline, SPF query counter, failed checks."""

    def __init__(self, budget):
        self.deadline = time.monotonic() + budget
        self.lock = threading.Lock()
        self.failed = {}  # check label -> "timed out" | "failed"

    def mark(self, label, what):
        with self.lock:
            self.failed.setdefault(label, what)


def _query(ctx, label, name, rdtype):
    """One DNS query. Returns (status, rdata list); status is ok / none /
    timeout / error. Never raises."""
    import dns.exception
    import dns.resolver

    remaining = ctx.deadline - time.monotonic()
    if remaining <= 0:
        ctx.mark(label, "timed out")
        return "timeout", []
    resolver = dns.resolver.Resolver()
    resolver.timeout = min(QUERY_LIFETIME, remaining)
    resolver.lifetime = min(QUERY_LIFETIME, remaining)
    try:
        return "ok", list(resolver.resolve(name, rdtype))
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return "none", []
    except dns.exception.Timeout:
        ctx.mark(label, "timed out")
        return "timeout", []
    except Exception:  # SERVFAIL (NoNameservers) and anything else odd
        ctx.mark(label, "failed")
        return "error", []


def _txtRecords(ctx, label, name):
    """TXT strings, one joined string per record (character-strings concatenated)."""
    status, rdata = _query(ctx, label, name, "TXT")
    out = []
    for rr in rdata:
        out.append(b"".join(rr.strings).decode("utf-8", "replace"))
    return status, out


# --- SPF --------------------------------------------------------------------


def parseSpf(record):
    """Split a v=spf1 record into (mechanisms, modifiers)."""
    mechanisms, modifiers = [], []
    for tok in record.split()[1:]:
        m = _MODIFIER_RE.match(tok)
        if m:
            modifiers.append({"name": m.group(1).lower(), "value": m.group(2)})
            continue
        qualifier = "+"
        if tok[0] in "+-~?":
            qualifier, tok = tok[0], tok[1:]
        name, _, value = tok.partition(":")
        name, _, _ = name.partition("/")  # a/24, mx/24 -> a, mx
        value = value.split("/")[0]
        mechanisms.append({"qualifier": qualifier, "mechanism": name.lower(), "value": value})
    return mechanisms, modifiers


def _isSpf(txt):
    return txt.strip().lower().startswith("v=spf1") and (len(txt.strip()) == 6 or txt.strip()[6].isspace())


def _spfWalk(ctx, state, domain, via, path, depth):
    """Resolve one SPF node and recurse into include:/redirect=. `state` holds
    the running lookup count and TXT-query count (single thread)."""
    node = {"domain": domain, "via": via, "record": None, "error": None, "children": []}
    if domain.lower() in path:
        node["error"] = "loop: this domain is already being evaluated"
        return node, [], []
    if depth > SPF_MAX_DEPTH:
        node["error"] = f"recursion deeper than {SPF_MAX_DEPTH} levels; not followed"
        state["truncated"] = True
        return node, [], []
    if state["queries"] >= SPF_MAX_TXT_QUERIES:
        node["error"] = f"stopped after {SPF_MAX_TXT_QUERIES} TXT queries; not followed"
        state["truncated"] = True
        return node, [], []
    state["queries"] += 1
    status, txts = _txtRecords(ctx, "SPF", domain)
    spf = [t for t in txts if _isSpf(t)]
    if status in ("timeout", "error"):
        node["error"] = "lookup " + ("timed out" if status == "timeout" else "failed")
        return node, [], []
    if depth == 0:
        state["rootCount"] = len(spf)
    if not spf:
        node["error"] = "no SPF record"
        return node, [], []
    node["record"] = spf[0]
    if depth == 0:
        state["rootCount"] = len(spf)
    if len(spf) > 1:
        node["error"] = f"multiple SPF records ({len(spf)}); permerror"
    mechanisms, modifiers = parseSpf(spf[0])
    newPath = path | {domain.lower()}
    children = [(m["mechanism"], m["value"]) for m in mechanisms if m["mechanism"] == "include" and m["value"]]
    children += [("redirect", mod["value"]) for mod in modifiers if mod["name"] == "redirect" and mod["value"]]
    for m in mechanisms:
        if m["mechanism"] in _LOOKUP_TERMS:
            state["count"] += 1
    for _ in [x for x in modifiers if x["name"] == "redirect"]:
        state["count"] += 1
    for kind, target in children:
        child, _, _ = _spfWalk(ctx, state, target.rstrip("."), kind, newPath, depth + 1)
        node["children"].append(child)
    return node, mechanisms, modifiers


def _nodes(node):
    yield node
    for c in node["children"]:
        yield from _nodes(c)


def _collectErrors(node, out):
    if node["error"]:
        out.append(f"{node['domain']}: {node['error']}")
    for c in node["children"]:
        _collectErrors(c, out)


def checkSpf(ctx, domain):
    state = {"count": 0, "queries": 0, "truncated": False}
    tree, mechanisms, modifiers = _spfWalk(ctx, state, domain, None, frozenset(), 0)
    out = {"present": tree["record"] is not None, "record": tree["record"],
           "recordCount": state.get("rootCount", 0), "mechanisms": mechanisms, "modifiers": modifiers,
           "all": None, "lookupCount": state["count"], "tree": tree, "errors": [], "notes": []}
    for m in mechanisms:
        if m["mechanism"] == "all":
            out["all"] = m["qualifier"]
    _collectErrors(tree, out["errors"])
    if state["truncated"]:
        out["notes"].append(
            f"Include tree truncated (max depth {SPF_MAX_DEPTH} or {SPF_MAX_TXT_QUERIES} TXT queries)."
        )
    if out["all"] == "~":
        out["notes"].append("~all (softfail) is acceptable; -all is stricter.")
    return out


# --- DMARC / simple presence -------------------------------------------------


def parseTags(record):
    tags = {}
    for part in record.split(";"):
        k, sep, v = part.partition("=")
        if sep and k.strip():
            tags.setdefault(k.strip().lower(), v.strip())
    return tags


def checkDmarc(ctx, domain):
    status, txts = _txtRecords(ctx, "DMARC", f"_dmarc.{domain}")
    recs = [t for t in txts if t.strip().lower().startswith("v=dmarc1")]
    out = {"present": bool(recs), "record": recs[0] if recs else None, "tags": {}, "error": None}
    if recs:
        out["tags"] = parseTags(recs[0])
        if len(recs) > 1:
            out["error"] = f"multiple DMARC records ({len(recs)}); receivers ignore them"
    return out


def checkPresence(ctx, label, name, prefix):
    status, txts = _txtRecords(ctx, label, name)
    recs = [t for t in txts if t.strip().lower().startswith(prefix)]
    return {"present": bool(recs), "record": recs[0] if recs else None}


# --- DKIM ---------------------------------------------------------------------


def _derRead(b, pos):
    """Read one DER TLV at pos -> (tag, content_start, content_end)."""
    tag = b[pos]
    length = b[pos + 1]
    pos += 2
    if length & 0x80:
        n = length & 0x7F
        length = int.from_bytes(b[pos:pos + n], "big")
        pos += n
    if pos + length > len(b):
        raise ValueError("truncated DER")
    return tag, pos, pos + length


def rsaKeyBits(der):
    """Modulus bit length of an RSA public key given as DER SubjectPublicKeyInfo
    or a bare RSAPublicKey. Returns None if it can't be parsed."""
    try:
        tag, s, e = _derRead(der, 0)
        if tag != 0x30:
            return None
        t1, s1, e1 = _derRead(der, s)
        if t1 == 0x30:  # SPKI: AlgorithmIdentifier, then BIT STRING wrapping RSAPublicKey
            t2, s2, e2 = _derRead(der, e1)
            if t2 != 0x03:
                return None
            return rsaKeyBits(der[s2 + 1:e2])  # skip the unused-bits byte
        if t1 == 0x02:  # bare RSAPublicKey: modulus INTEGER first
            return int.from_bytes(der[s1:e1], "big").bit_length()
    except (IndexError, ValueError):
        pass
    return None


def parseDkim(selector, txts):
    """Build the per-selector result from the TXT records found there."""
    row = {"selector": selector, "found": False, "keyType": None, "keyBits": None, "warnings": []}
    recs = [(t, parseTags(t)) for t in txts]
    recs = [(t, tags) for t, tags in recs if "p" in tags or tags.get("v", "").upper() == "DKIM1"]
    if not recs:
        return row
    row["found"] = True
    tags = recs[0][1]
    ktype = tags.get("k", "rsa").lower()
    row["keyType"] = ktype
    p = re.sub(r"\s+", "", tags.get("p", ""))
    if not p:
        row["warnings"].append("Key revoked (empty p=)")
        return row
    if ktype == "ed25519":
        row["keyBits"] = 256
        return row
    try:
        der = base64.b64decode(p + "=" * (-len(p) % 4))
    except Exception:
        der = b""
    bits = rsaKeyBits(der)
    if bits is None:
        row["warnings"].append("Could not parse public key")
    else:
        row["keyBits"] = bits
        if bits < 1024:
            row["warnings"].append(f"{bits}-bit key is too weak")
        elif bits == 1024:
            row["warnings"].append("1024-bit key; upgrade to 2048")
    return row


def checkDkim(ctx, domain, selector):
    status, txts = _txtRecords(ctx, "DKIM", f"{selector}._domainkey.{domain}")
    return parseDkim(selector, txts)


def checkMx(ctx, domain):
    status, rdata = _query(ctx, "MX", domain, "MX")
    rows = [{"preference": int(r.preference), "host": str(r.exchange).rstrip(".") or "."} for r in rdata]
    return sorted(rows, key=lambda r: (r["preference"], r["host"]))


# --- grading ---------------------------------------------------------------------

# Score starts at 100: high -30, medium -10, low -3.
# A >= 90, B >= 75, C >= 60, D >= 40, else F.
_PENALTY = {"high": 30, "medium": 10, "low": 3}
_ORDER = {"high": 0, "medium": 1, "low": 2}


def gradeFor(fixes):
    score = max(0, 100 - sum(_PENALTY[f["severity"]] for f in fixes))
    for letter, floor in (("A", 90), ("B", 75), ("C", 60), ("D", 40)):
        if score >= floor:
            return letter
    return "F"


def buildFixes(r, failed):
    """Derive the fix list from the collected results. Checks that timed out
    or errored are skipped (we don't know the state) and reported as warnings."""
    fixes = []

    def add(sev, msg):
        fixes.append({"severity": sev, "message": msg})

    spf = r["spf"]
    if "SPF" not in failed:
        if not spf["present"]:
            if spf["recordCount"] == 0:
                add("high", "No SPF record. Publish a TXT record starting with v=spf1.")
        else:
            if spf["lookupCount"] > SPF_LOOKUP_LIMIT:
                add("high", f"SPF exceeds the 10 DNS-lookup limit: {spf['lookupCount']}. Remove includes or flatten the record.")
            for n in _nodes(spf["tree"]):
                err = n["error"] or ""
                if err.startswith("multiple"):
                    add("high", f"SPF at {n['domain']}: {err}. Merge into one record.")
                elif err.startswith("loop") or (err == "no SPF record" and n["via"]):
                    add("high", f"SPF at {n['domain']}: {err}.")
            q = spf["all"]
            if q == "+":
                add("high", "SPF ends in +all, which authorizes every sender. Use -all or ~all.")
            elif q == "?":
                add("medium", "SPF ends in ?all (neutral), which gives no protection. Use ~all or -all.")
            elif q is None and not any(m["name"] == "redirect" for m in spf["modifiers"]):
                add("medium", "SPF has no all mechanism; it defaults to neutral. End the record with -all or ~all.")
            if any(m["mechanism"] == "ptr" for m in spf["mechanisms"]):
                add("low", "SPF uses the ptr mechanism, which is deprecated (RFC 7208). Replace it with ip4/ip6/include.")

    d = r["dmarc"]
    if "DMARC" not in failed:
        if not d["present"]:
            add("high", "No DMARC record. Publish a TXT record at _dmarc with v=DMARC1; p=...; rua=...")
        else:
            if d["error"]:
                add("high", d["error"][0].upper() + d["error"][1:] + ".")
            tags = d["tags"]
            p = tags.get("p", "").lower()
            if p not in ("none", "quarantine", "reject"):
                add("high", "DMARC has a missing or invalid p= policy (must be none, quarantine or reject).")
            elif p == "none":
                add("medium", "DMARC p=none is monitoring only, not enforcing. Move to quarantine or reject once reports look clean.")
            if not tags.get("rua"):
                add("medium", "DMARC has no rua= tag, so you will not receive aggregate reports.")
            try:
                if "pct" in tags and int(tags["pct"]) < 100:
                    add("low", f"DMARC pct={tags['pct']} applies the policy to only part of your mail. Raise it to 100.")
            except ValueError:
                pass

    dkim = r["dkim"]
    for k in dkim:
        if k["keyBits"] is not None and k["keyType"] != "ed25519":
            if k["keyBits"] < 1024:
                add("high", f"DKIM selector {k['selector']} uses a {k['keyBits']}-bit key. Rotate to 2048 bits.")
            elif k["keyBits"] == 1024:
                add("low", f"DKIM selector {k['selector']} uses a 1024-bit key. Upgrade to 2048 bits.")
    if "DKIM" not in failed and not any(k["found"] for k in dkim):
        add("medium", "No DKIM record found for common selectors; supply your selector.")

    if "MX" not in failed and not r["mx"]:
        add("medium", "No MX records; the domain cannot receive mail.")
    if "MTA-STS" not in failed and not r["mtaSts"]["present"]:
        add("low", "No MTA-STS record (_mta-sts). Consider enforcing TLS for inbound mail.")
    if "TLS-RPT" not in failed and not r["tlsRpt"]["present"]:
        add("low", "No TLS-RPT record (_smtp._tls). Add one to receive TLS failure reports.")

    fixes.sort(key=lambda f: _ORDER[f["severity"]])
    return fixes


# --- orchestration --------------------------------------------------------------------


def lookup(domain, selectors=(), budget=BUDGET_SECONDS):
    """Run every check concurrently within `budget` seconds and grade the result."""
    ctx = _Ctx(budget)
    sels = []
    for s in list(selectors) + DEFAULT_SELECTORS:
        if s not in sels:
            sels.append(s)
    jobs = {
        "spf": lambda: checkSpf(ctx, domain),
        "dmarc": lambda: checkDmarc(ctx, domain),
        "mx": lambda: checkMx(ctx, domain),
        "mtaSts": lambda: checkPresence(ctx, "MTA-STS", f"_mta-sts.{domain}", "v=stsv1"),
        "tlsRpt": lambda: checkPresence(ctx, "TLS-RPT", f"_smtp._tls.{domain}", "v=tlsrptv1"),
        "bimi": lambda: checkPresence(ctx, "BIMI", f"default._bimi.{domain}", "v=bimi1"),
    }
    pool = ThreadPoolExecutor(max_workers=MAX_WORKERS)
    futures = {k: pool.submit(fn) for k, fn in jobs.items()}
    dkimFutures = [pool.submit(checkDkim, ctx, domain, s) for s in sels]
    wait(list(futures.values()) + dkimFutures, timeout=budget)
    pool.shutdown(wait=False, cancel_futures=True)

    empty = {
        "spf": {"present": False, "record": None, "recordCount": 0, "mechanisms": [], "modifiers": [],
                "all": None, "lookupCount": 0, "tree": None, "errors": [], "notes": []},
        "dmarc": {"present": False, "record": None, "tags": {}, "error": None},
        "mx": [],
        "mtaSts": {"present": False, "record": None},
        "tlsRpt": {"present": False, "record": None},
        "bimi": {"present": False, "record": None},
    }
    labels = {"spf": "SPF", "dmarc": "DMARC", "mx": "MX", "mtaSts": "MTA-STS", "tlsRpt": "TLS-RPT", "bimi": "BIMI"}
    result = {"domain": domain}
    for key, fut in futures.items():
        if fut.done() and not fut.cancelled() and fut.exception() is None:
            result[key] = fut.result()
        else:
            result[key] = empty[key]
            ctx.mark(labels[key], "timed out")
    result["dkim"] = []
    for s, fut in zip(sels, dkimFutures):
        if fut.done() and not fut.cancelled() and fut.exception() is None:
            result["dkim"].append(fut.result())
        else:
            result["dkim"].append({"selector": s, "found": False, "keyType": None, "keyBits": None, "warnings": []})
            ctx.mark("DKIM", "timed out")

    warnings = [f"{label} check {what}; results may be incomplete." for label, what in ctx.failed.items()]
    if result["spf"]["tree"] and any("truncated" in n for n in result["spf"]["notes"]):
        warnings.append(result["spf"]["notes"][0])
    if any(m["host"] == "." for m in result["mx"]):
        warnings.append("Null MX (0 .) published: this domain does not accept mail.")
    result["warnings"] = warnings

    fixes = buildFixes(result, set(ctx.failed))
    result["fixes"] = fixes
    result["grade"] = gradeFor(fixes)
    return {k: result[k] for k in ("domain", "grade", "fixes", "spf", "dmarc", "dkim", "mx", "mtaSts", "tlsRpt", "bimi", "warnings")}
