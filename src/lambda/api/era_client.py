"""
Era.app read-only client. STRICTLY read/GET — no write methods, by design
(guardrail: the app must never mutate Era data; do not add write methods).

Era's REST surface is not publicly documented (checked 2026-07-07:
era.app/developers, era.app/api, docs.era.app all 404; api.era.app/health
returns 200). Paths below are a documented guess recorded in FUNK-22;
ERA_API_BASE env overrides the base URL without a code change.
"""
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ERA_API_BASE = os.environ.get("ERA_API_BASE", "https://api.era.app/v1")
FETCH_TIMEOUT_SEC = 10
CACHE_TTL_SEC = 300

# ponytail: module-level cache per lambda container; DynamoDB cache item only
# if Era rate limits bite on staging.
_cache: dict = {}


def is_connected():
    """True when an Era API key is configured."""
    return bool(os.environ.get("ERA_API_KEY", "").strip())


def _get(path, params=None):
    """GET Era endpoint with bearer auth + TTL cache. Returns parsed JSON or None."""
    if not is_connected():
        return None
    qs = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v})
    url = f"{ERA_API_BASE}{path}" + (f"?{qs}" if qs else "")
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < CACHE_TTL_SEC:
        return hit[1]
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {os.environ['ERA_API_KEY'].strip()}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        _cache[url] = (time.time(), data)
        return data
    except Exception as e:
        logger.warning("era GET %s failed: %s", path, e)
        return None


def get_accounts():
    """Era accounts + balances, tagged source=era. Returns list (empty on error)."""
    data = _get("/accounts")
    if not data:
        return []
    items = data if isinstance(data, list) else data.get("accounts") or data.get("data") or []
    out = []
    for a in items:
        if not isinstance(a, dict):
            continue
        out.append({
            "id": str(a.get("id") or a.get("account_id") or ""),
            "name": a.get("name") or a.get("display_name") or "Era account",
            "kind": a.get("type") or a.get("kind") or "checking",
            "balance": float(a.get("balance") or a.get("current_balance") or 0),
            "currency": a.get("currency") or "USD",
            "source": "era",
        })
    return out


def get_transactions(from_date=None, to_date=None, q=None):
    """Era transactions, tagged source=era + read-only. Returns list (empty on error)."""
    data = _get("/transactions", {"from": from_date, "to": to_date, "q": q})
    if not data:
        return []
    items = data if isinstance(data, list) else data.get("transactions") or data.get("data") or []
    out = []
    for t in items:
        if not isinstance(t, dict):
            continue
        out.append({
            "id": str(t.get("id") or ""),
            "accountId": str(t.get("account_id") or t.get("accountId") or ""),
            "date": (t.get("date") or t.get("posted_at") or "")[:10],
            "amount": float(t.get("amount") or 0),
            "payee": t.get("payee") or t.get("merchant") or t.get("description") or "",
            "category": t.get("category") or "Other",
            "notes": t.get("notes") or "",
            "source": "era",
        })
    return out


def get_insights(period=None):
    """Era insights (spending analysis / comparison / forecast). Returns dict or None."""
    spending = _get("/insights/spending", {"period": period})
    compare = _get("/insights/compare", {"period": period})
    forecast = _get("/insights/forecast", {"period": period})
    if not (spending or compare or forecast):
        return None
    return {"spending": spending, "comparison": compare, "forecast": forecast}
