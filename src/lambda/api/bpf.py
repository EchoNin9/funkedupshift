"""
Personal Finances (B&PF phase 1): manual accounts/transactions/budgets,
computed insights, per-section read-only sharing, optional Era merge,
Bedrock Sonnet insight summaries.

DynamoDB single table, BPF#* sort keys under USER#{id}. Transaction SK embeds
the date (BPF#TXN#{date}#{uuid}) so ranges are key queries — no GSI.
Transaction ids exposed to clients are "{date}_{uuid}" so the SK is
reconstructible from a path parameter.
"""
import json
import logging
import os
import uuid
from datetime import date, datetime, timedelta, timezone

from api import era_client

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

# Verified via bedrock list-foundation-models 2026-07-07: anthropic.claude-sonnet-5
# supports INFERENCE_PROFILE only, so invoke via the us. profile.
BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-5"
MAX_PROMPT_CHARS = 6000

ACCOUNT_KINDS = ("checking", "savings", "credit", "cash", "asset", "liability")
SECTIONS = ("dashboard", "transactions", "budgets", "insights")
DEFAULT_CATEGORIES = [
    "Income", "Groceries", "Dining", "Housing", "Utilities", "Transportation",
    "Insurance", "Healthcare", "Entertainment", "Shopping", "Subscriptions",
    "Travel", "Gifts", "Fees", "Other",
]


def _ddb():
    import boto3
    return boto3.client("dynamodb")


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _query_prefix(user_id, sk_prefix):
    """All items under USER#{id} whose SK begins with sk_prefix."""
    items, key = [], None
    while True:
        kwargs = {
            "TableName": TABLE_NAME,
            "KeyConditionExpression": "PK = :pk AND begins_with(SK, :sk)",
            "ExpressionAttributeValues": {
                ":pk": {"S": f"USER#{user_id}"},
                ":sk": {"S": sk_prefix},
            },
        }
        if key:
            kwargs["ExclusiveStartKey"] = key
        resp = _ddb().query(**kwargs)
        items.extend(resp.get("Items", []))
        key = resp.get("LastEvaluatedKey")
        if not key:
            return items


# ------------------------------------------------------------------------------
# Accounts
# ------------------------------------------------------------------------------

def _account_from_item(item):
    return {
        "id": item["SK"]["S"].split("BPF#ACCOUNT#")[-1],
        "name": item.get("name", {}).get("S", ""),
        "kind": item.get("kind", {}).get("S", "checking"),
        "balance": float(item.get("balance", {}).get("N", "0")),
        "currency": item.get("currency", {}).get("S", "USD"),
        "updatedAt": item.get("updatedAt", {}).get("S", ""),
        "source": "local",
    }


def list_accounts(user_id):
    return [_account_from_item(i) for i in _query_prefix(user_id, "BPF#ACCOUNT#")]


def _validate_account(data):
    """Returns (clean_dict, error_str)."""
    name = str(data.get("name") or "").strip()
    if not name:
        return None, "name is required"
    kind = str(data.get("kind") or "checking").strip().lower()
    if kind not in ACCOUNT_KINDS:
        return None, f"kind must be one of: {', '.join(ACCOUNT_KINDS)}"
    try:
        balance = float(data.get("balance") or 0)
    except (TypeError, ValueError):
        return None, "balance must be a number"
    currency = str(data.get("currency") or "USD").strip().upper()[:8]
    return {"name": name, "kind": kind, "balance": balance, "currency": currency}, None


def save_account(user_id, data, account_id=None):
    """Create (account_id None) or replace. Returns (account, error)."""
    clean, err = _validate_account(data)
    if err:
        return None, err
    account_id = account_id or uuid.uuid4().hex
    now = _now()
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{user_id}"},
            "SK": {"S": f"BPF#ACCOUNT#{account_id}"},
            "name": {"S": clean["name"]},
            "kind": {"S": clean["kind"]},
            "balance": {"N": str(clean["balance"])},
            "currency": {"S": clean["currency"]},
            "updatedAt": {"S": now},
        },
    )
    return {**clean, "id": account_id, "updatedAt": now, "source": "local"}, None


def account_exists(user_id, account_id):
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": f"BPF#ACCOUNT#{account_id}"}},
    )
    return "Item" in resp


def delete_account(user_id, account_id):
    """Returns True if the account existed."""
    if not account_exists(user_id, account_id):
        return False
    _ddb().delete_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": f"BPF#ACCOUNT#{account_id}"}},
    )
    return True


# ------------------------------------------------------------------------------
# Transactions
# ------------------------------------------------------------------------------

def _txn_from_item(item):
    sk = item["SK"]["S"]  # BPF#TXN#{date}#{uuid}
    parts = sk.split("#")
    return {
        "id": f"{parts[2]}_{parts[3]}",
        "date": parts[2],
        "accountId": item.get("accountId", {}).get("S", ""),
        "amount": float(item.get("amount", {}).get("N", "0")),
        "payee": item.get("payee", {}).get("S", ""),
        "category": item.get("category", {}).get("S", "Other"),
        "notes": item.get("notes", {}).get("S", ""),
        "business": item.get("business", {}).get("BOOL", False),
        "updatedAt": item.get("updatedAt", {}).get("S", ""),
        "source": "local",
    }


def _txn_sk(txn_id):
    """Client id '{date}_{uuid}' -> SK, or None if malformed."""
    if "_" not in (txn_id or ""):
        return None
    d, _, u = txn_id.partition("_")
    if len(d) != 10 or not u:
        return None
    return f"BPF#TXN#{d}#{u}"


def _validate_txn(data):
    d = str(data.get("date") or "").strip()[:10]
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        return None, "date must be YYYY-MM-DD"
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return None, "amount must be a number (negative = spend)"
    return {
        "date": d,
        "amount": amount,
        "accountId": str(data.get("accountId") or "").strip(),
        "payee": str(data.get("payee") or "").strip(),
        "category": str(data.get("category") or "Other").strip() or "Other",
        "notes": str(data.get("notes") or "").strip(),
    }, None


def list_transactions(user_id, from_date=None, to_date=None, q=None, category=None):
    """Local transactions, newest first. Date range via SK BETWEEN; q/category filtered in Python."""
    if from_date or to_date:
        resp_items, key = [], None
        lo = f"BPF#TXN#{from_date or '0000-00-00'}"
        hi = f"BPF#TXN#{to_date or '9999-99-99'}~"  # '~' sorts after '#' + hex uuids
        while True:
            kwargs = {
                "TableName": TABLE_NAME,
                "KeyConditionExpression": "PK = :pk AND SK BETWEEN :lo AND :hi",
                "ExpressionAttributeValues": {
                    ":pk": {"S": f"USER#{user_id}"},
                    ":lo": {"S": lo},
                    ":hi": {"S": hi},
                },
            }
            if key:
                kwargs["ExclusiveStartKey"] = key
            resp = _ddb().query(**kwargs)
            resp_items.extend(resp.get("Items", []))
            key = resp.get("LastEvaluatedKey")
            if not key:
                break
        items = resp_items
    else:
        items = _query_prefix(user_id, "BPF#TXN#")
    txns = [_txn_from_item(i) for i in items]
    if category:
        txns = [t for t in txns if t["category"].lower() == category.lower()]
    if q:
        ql = q.lower()
        txns = [t for t in txns if ql in t["payee"].lower() or ql in t["notes"].lower()
                or ql in t["category"].lower()]
    txns.sort(key=lambda t: (t["date"], t["id"]), reverse=True)
    return txns


def save_transaction(user_id, data, txn_id=None):
    """Create or update. Date changes move the item (SK embeds date). Returns (txn, error)."""
    clean, err = _validate_txn(data)
    if err:
        return None, err
    if txn_id:
        old_sk = _txn_sk(txn_id)
        if not old_sk:
            return None, "invalid transaction id"
        old_uuid = old_sk.split("#")[-1]
        new_sk = f"BPF#TXN#{clean['date']}#{old_uuid}"
        if new_sk != old_sk:
            _ddb().delete_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": old_sk}},
            )
        sk = new_sk
        new_id = f"{clean['date']}_{old_uuid}"
    else:
        u = uuid.uuid4().hex
        sk = f"BPF#TXN#{clean['date']}#{u}"
        new_id = f"{clean['date']}_{u}"
    now = _now()
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{user_id}"},
            "SK": {"S": sk},
            "accountId": {"S": clean["accountId"]},
            "amount": {"N": str(clean["amount"])},
            "payee": {"S": clean["payee"]},
            "category": {"S": clean["category"]},
            "notes": {"S": clean["notes"]},
            "business": {"BOOL": False},  # phase-2 hook, always false in P1
            "updatedAt": {"S": now},
        },
    )
    _ensure_category(user_id, clean["category"])
    return {**clean, "id": new_id, "business": False, "updatedAt": now, "source": "local"}, None


def delete_transaction(user_id, txn_id):
    sk = _txn_sk(txn_id)
    if not sk:
        return False
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": sk}},
    )
    if "Item" not in resp:
        return False
    _ddb().delete_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": sk}},
    )
    return True


# ------------------------------------------------------------------------------
# Settings (categories) + Budgets
# ------------------------------------------------------------------------------

def get_categories(user_id):
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "BPF#SETTINGS"}},
    )
    if "Item" not in resp:
        return list(DEFAULT_CATEGORIES)
    return [c.get("S", "") for c in resp["Item"].get("categories", {}).get("L", []) if c.get("S")]


def _save_categories(user_id, categories):
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{user_id}"},
            "SK": {"S": "BPF#SETTINGS"},
            "categories": {"L": [{"S": c} for c in categories]},
            "updatedAt": {"S": _now()},
        },
    )


def _ensure_category(user_id, category):
    """Seed defaults on first write; append unseen categories."""
    cats = get_categories(user_id)
    if category and category not in cats:
        cats.append(category)
    _save_categories(user_id, cats)


def get_budgets(user_id):
    """Budgets with month-to-date actual spend per category."""
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "BPF#BUDGETS"}},
    )
    budgets = []
    if "Item" in resp:
        for m in resp["Item"].get("budgets", {}).get("L", []):
            mm = m.get("M", {})
            budgets.append({
                "category": mm.get("category", {}).get("S", ""),
                "monthlyLimit": float(mm.get("monthlyLimit", {}).get("N", "0")),
            })
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    txns = list_transactions(user_id, from_date=month_start, to_date=today.isoformat())
    actuals = {}
    for t in txns:
        if t["amount"] < 0:
            actuals[t["category"]] = actuals.get(t["category"], 0.0) + (-t["amount"])
    for b in budgets:
        b["actual"] = round(actuals.get(b["category"], 0.0), 2)
    return budgets


def save_budgets(user_id, budgets):
    """Replace budgets. Returns (clean_list, error)."""
    if not isinstance(budgets, list):
        return None, "budgets must be an array"
    clean = []
    for b in budgets:
        if not isinstance(b, dict) or not str(b.get("category") or "").strip():
            return None, "each budget needs a category"
        try:
            limit = float(b.get("monthlyLimit"))
        except (TypeError, ValueError):
            return None, "monthlyLimit must be a number"
        clean.append({"category": str(b["category"]).strip(), "monthlyLimit": limit})
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{user_id}"},
            "SK": {"S": "BPF#BUDGETS"},
            "budgets": {"L": [
                {"M": {"category": {"S": b["category"]},
                       "monthlyLimit": {"N": str(b["monthlyLimit"])}}}
                for b in clean
            ]},
            "updatedAt": {"S": _now()},
        },
    )
    return clean, None


# ------------------------------------------------------------------------------
# Sharing (grant + mirror written/deleted together)
# ------------------------------------------------------------------------------

def list_shares(user_id):
    out = []
    for i in _query_prefix(user_id, "BPF#SHARE#"):
        out.append({
            "granteeId": i["SK"]["S"].split("BPF#SHARE#")[-1],
            "granteeEmail": i.get("granteeEmail", {}).get("S", ""),
            "sections": [s.get("S", "") for s in i.get("sections", {}).get("L", [])],
            "createdAt": i.get("createdAt", {}).get("S", ""),
        })
    return out


def list_shared_with_me(user_id):
    out = []
    for i in _query_prefix(user_id, "BPF#SHAREDWITH#"):
        out.append({
            "ownerId": i["SK"]["S"].split("BPF#SHAREDWITH#")[-1],
            "ownerEmail": i.get("ownerEmail", {}).get("S", ""),
            "sections": [s.get("S", "") for s in i.get("sections", {}).get("L", [])],
            "createdAt": i.get("createdAt", {}).get("S", ""),
        })
    return out


def get_share_sections(owner_id, grantee_id):
    """Sections granted by owner to grantee, or None if no grant."""
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{owner_id}"}, "SK": {"S": f"BPF#SHARE#{grantee_id}"}},
    )
    if "Item" not in resp:
        return None
    return [s.get("S", "") for s in resp["Item"].get("sections", {}).get("L", [])]


def put_share(owner_id, owner_email, grantee_id, grantee_email, sections):
    """Upsert grant + mirror. Returns (share, error)."""
    sections = [s for s in sections if s in SECTIONS]
    if not sections:
        return None, f"sections must be a non-empty subset of: {', '.join(SECTIONS)}"
    if grantee_id == owner_id:
        return None, "cannot share with yourself"
    now = _now()
    sections_attr = {"L": [{"S": s} for s in sections]}
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{owner_id}"},
            "SK": {"S": f"BPF#SHARE#{grantee_id}"},
            "granteeEmail": {"S": grantee_email},
            "sections": sections_attr,
            "createdAt": {"S": now},
        },
    )
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{grantee_id}"},
            "SK": {"S": f"BPF#SHAREDWITH#{owner_id}"},
            "ownerEmail": {"S": owner_email},
            "sections": sections_attr,
            "createdAt": {"S": now},
        },
    )
    return {"granteeId": grantee_id, "granteeEmail": grantee_email,
            "sections": sections, "createdAt": now}, None


def delete_share(owner_id, grantee_id):
    """Delete grant + mirror. Returns True if the grant existed."""
    existed = get_share_sections(owner_id, grantee_id) is not None
    _ddb().delete_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{owner_id}"}, "SK": {"S": f"BPF#SHARE#{grantee_id}"}},
    )
    _ddb().delete_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{grantee_id}"}, "SK": {"S": f"BPF#SHAREDWITH#{owner_id}"}},
    )
    return existed


# ------------------------------------------------------------------------------
# Payloads (local + Era merged) — also consumed by the MCP lambda
# ------------------------------------------------------------------------------

def overview_payload(user_id):
    """Dashboard: accounts (local ∪ Era), net worth, 30-day cash flow, 90-day series."""
    accounts = list_accounts(user_id) + era_client.get_accounts()
    net_worth = round(sum(a["balance"] for a in accounts), 2)
    today = date.today()
    d90 = (today - timedelta(days=90)).isoformat()
    d30 = (today - timedelta(days=30)).isoformat()
    txns = list_transactions(user_id, from_date=d90, to_date=today.isoformat())
    txns += era_client.get_transactions(from_date=d90, to_date=today.isoformat())
    income = sum(t["amount"] for t in txns if t["date"] >= d30 and t["amount"] > 0)
    spend = sum(-t["amount"] for t in txns if t["date"] >= d30 and t["amount"] < 0)
    daily = {}
    for t in txns:
        daily[t["date"]] = daily.get(t["date"], 0.0) + t["amount"]
    series, running = [], 0.0
    for d in sorted(daily):
        running += daily[d]
        series.append({"date": d, "net": round(running, 2)})
    return {
        "accounts": accounts,
        "netWorth": net_worth,
        "cashFlow30d": {"income": round(income, 2), "spend": round(spend, 2),
                        "net": round(income - spend, 2)},
        "cashFlowSeries90d": series,
        "eraConnected": era_client.is_connected(),
    }


def transactions_payload(user_id, from_date=None, to_date=None, q=None, category=None):
    txns = list_transactions(user_id, from_date, to_date, q, category)
    era = era_client.get_transactions(from_date, to_date, q)
    if category:
        era = [t for t in era if t["category"].lower() == category.lower()]
    merged = sorted(txns + era, key=lambda t: (t["date"], t["id"]), reverse=True)
    return {"transactions": merged, "eraConnected": era_client.is_connected()}


def _month_bounds(yyyymm):
    start = datetime.strptime(yyyymm + "-01", "%Y-%m-%d").date()
    nxt = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start.isoformat(), (nxt - timedelta(days=1)).isoformat()


def insights_payload(user_id, period=None):
    """Spending by category for period (YYYY-MM, default current month),
    vs previous month, plus a naive 3-month forecast."""
    today = date.today()
    period = (period or today.strftime("%Y-%m")).strip()[:7]
    try:
        p_start, p_end = _month_bounds(period)
    except ValueError:
        period = today.strftime("%Y-%m")
        p_start, p_end = _month_bounds(period)
    prev_month = (datetime.strptime(p_start, "%Y-%m-%d").date() - timedelta(days=1)).strftime("%Y-%m")
    q_start, q_end = _month_bounds(prev_month)

    def _by_category(txns):
        out = {}
        for t in txns:
            if t["amount"] < 0:
                out[t["category"]] = round(out.get(t["category"], 0.0) - t["amount"], 2)
        return out

    cur = list_transactions(user_id, from_date=p_start, to_date=p_end)
    prev = list_transactions(user_id, from_date=q_start, to_date=q_end)

    # ponytail: naive projection — avg net flow of last 3 months forward 3;
    # revisit if Adam wants Era's forecast surface to drive it.
    f_start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    f_start = (f_start - timedelta(days=1)).replace(day=1)
    hist = list_transactions(user_id, from_date=f_start.isoformat(), to_date=today.isoformat())
    months = max(1, (today.year - f_start.year) * 12 + today.month - f_start.month + 1)
    avg_net = sum(t["amount"] for t in hist) / months
    forecast = []
    m = today
    for i in range(1, 4):
        nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        forecast.append({"month": nxt.strftime("%Y-%m"), "projectedNet": round(avg_net, 2)})
        m = nxt

    payload = {
        "period": period,
        "spendingByCategory": _by_category(cur),
        "comparison": {
            "period": period,
            "previousPeriod": prev_month,
            "spend": round(sum(-t["amount"] for t in cur if t["amount"] < 0), 2),
            "previousSpend": round(sum(-t["amount"] for t in prev if t["amount"] < 0), 2),
            "income": round(sum(t["amount"] for t in cur if t["amount"] > 0), 2),
            "previousIncome": round(sum(t["amount"] for t in prev if t["amount"] > 0), 2),
        },
        "forecast": forecast,
        "eraConnected": era_client.is_connected(),
    }
    era = era_client.get_insights(period)
    if era:
        payload["era"] = era
    return payload


# ------------------------------------------------------------------------------
# AI summary (Bedrock Claude Sonnet) — cost caps enforced here
# ------------------------------------------------------------------------------

def summarize_insights(user_id, period=None):
    """One Bedrock call, maxTokens 1024, truncated input. Returns (text, error)."""
    insights = insights_payload(user_id, period)
    insights.pop("era", None)  # keep prompt small and local-data-only
    prompt = (
        "You are a personal-finance assistant. Using ONLY the data below, write "
        "a <=150-word plain-language summary of this period's finances: notable "
        "category changes, budget overruns, cash-flow direction. End with "
        "'Not financial advice.'\n\n"
        + json.dumps({"insights": insights, "budgets": get_budgets(user_id)})[:MAX_PROMPT_CHARS]
    )
    try:
        import boto3
        client = boto3.client("bedrock-runtime",
                              region_name=os.environ.get("AWS_REGION", "us-east-1"))
        response = client.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 1024, "temperature": 0.3},
        )
        for block in response.get("output", {}).get("message", {}).get("content", []):
            if block.get("text"):
                return block["text"].strip(), None
        return None, "Empty response from model"
    except Exception as e:
        logger.exception("summarize_insights bedrock error: %s", e)
        return None, str(e)
