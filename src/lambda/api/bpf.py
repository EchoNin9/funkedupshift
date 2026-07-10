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
# Debt-nature accounts: the register tracks these as negative (money owed),
# but banks report the statement/ledger balance as a positive amount-owed.
DEBT_KINDS = ("credit", "liability")
SECTIONS = ("dashboard", "transactions", "budgets", "insights")
DEFAULT_CATEGORIES = [
    "Income", "Groceries", "Dining", "Housing", "Utilities", "Transportation",
    "Insurance", "Healthcare", "Entertainment", "Shopping", "Subscriptions",
    "Travel", "Gifts", "Fees", "Other",
]


_dynamodb = None


def _ddb():
    """Cached client — creating one per call added ~30s to large imports (503s)."""
    global _dynamodb
    if _dynamodb is None:
        import boto3
        _dynamodb = boto3.client("dynamodb")
    return _dynamodb


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
    """Account dict for API output. Full accountNumber never leaves the API —
    only the masked last 4. Balance is computed by list_accounts."""
    number = item.get("accountNumber", {}).get("S", "")
    # legacy items stored a static `balance`; treat it as the opening balance
    opening = item.get("openingBalance", item.get("balance", {})).get("N", "0")
    name = item.get("name", {}).get("S", "")
    bank = item.get("bank", {}).get("S", "")
    nickname = item.get("nickname", {}).get("S", "")
    masked = f"…{number[-4:]}" if number else ""
    display = nickname or " ".join(p for p in (bank, masked or name) if p) or name
    out = {
        "id": item["SK"]["S"].split("BPF#ACCOUNT#")[-1],
        "name": name,
        "bank": bank,
        "nickname": nickname,
        "accountNumberMasked": masked,
        "displayName": display,
        "kind": item.get("kind", {}).get("S", "checking"),
        "openingBalance": float(opening),
        "currency": item.get("currency", {}).get("S", "USD"),
        "updatedAt": item.get("updatedAt", {}).get("S", ""),
        "source": "local",
    }
    if "reconciledBalance" in item:
        out["reconciledBalance"] = float(item["reconciledBalance"]["N"])
        out["reconciledAt"] = item.get("reconciledAt", {}).get("S", "")
    if "csvMapping" in item:
        try:
            out["csvMapping"] = json.loads(item["csvMapping"]["S"])
        except (json.JSONDecodeError, KeyError):
            pass
    return out


def list_accounts(user_id, txns=None):
    """Accounts with computed balance = openingBalance + sum(transactions)."""
    accounts = [_account_from_item(i) for i in _query_prefix(user_id, "BPF#ACCOUNT#")]
    if accounts:
        if txns is None:
            txns = list_transactions(user_id)
        sums = {}
        for t in txns:
            if t.get("accountId"):
                sums[t["accountId"]] = sums.get(t["accountId"], 0.0) + t["amount"]
        for a in accounts:
            a["balance"] = round(a["openingBalance"] + sums.get(a["id"], 0.0), 2)
    return accounts


def find_account_by_number(user_id, number):
    """Full-number match for statement imports. Returns account id or None."""
    number = (number or "").strip()
    if not number:
        return None
    for item in _query_prefix(user_id, "BPF#ACCOUNT#"):
        if item.get("accountNumber", {}).get("S", "") == number:
            return item["SK"]["S"].split("BPF#ACCOUNT#")[-1]
    return None


def _validate_account(data):
    """Returns (clean_dict, error_str)."""
    name = str(data.get("name") or "").strip()
    if not name:
        return None, "name is required"
    kind = str(data.get("kind") or "checking").strip().lower()
    if kind not in ACCOUNT_KINDS:
        return None, f"kind must be one of: {', '.join(ACCOUNT_KINDS)}"
    try:
        # accept legacy `balance` as the opening balance
        opening = float(data.get("openingBalance", data.get("balance")) or 0)
    except (TypeError, ValueError):
        return None, "openingBalance must be a number"
    currency = str(data.get("currency") or "USD").strip().upper()[:8]
    return {
        "name": name,
        "kind": kind,
        "openingBalance": opening,
        "currency": currency,
        "bank": str(data.get("bank") or "").strip(),
        "accountNumber": str(data.get("accountNumber") or "").strip(),
        "nickname": str(data.get("nickname") or "").strip(),
    }, None


def save_account(user_id, data, account_id=None):
    """Create (account_id None) or replace. Returns (account, error)."""
    clean, err = _validate_account(data)
    if err:
        return None, err
    reconciled = {}
    if account_id:
        # carry reconciliation fields through edits
        resp = _ddb().get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": f"BPF#ACCOUNT#{account_id}"}},
        )
        old = resp.get("Item") or {}
        if "reconciledBalance" in old:
            reconciled = {"reconciledBalance": old["reconciledBalance"],
                          "reconciledAt": old.get("reconciledAt", {"S": ""})}
        if "csvMapping" in old:
            reconciled["csvMapping"] = old["csvMapping"]
        # the full number is never sent to clients, so a blank on edit means "keep"
        if not clean["accountNumber"]:
            clean["accountNumber"] = old.get("accountNumber", {}).get("S", "")
    account_id = account_id or uuid.uuid4().hex
    now = _now()
    item = {
        "PK": {"S": f"USER#{user_id}"},
        "SK": {"S": f"BPF#ACCOUNT#{account_id}"},
        "name": {"S": clean["name"]},
        "kind": {"S": clean["kind"]},
        "openingBalance": {"N": str(clean["openingBalance"])},
        "currency": {"S": clean["currency"]},
        "updatedAt": {"S": now},
        **reconciled,
    }
    for attr in ("bank", "accountNumber", "nickname"):
        if clean[attr]:
            item[attr] = {"S": clean[attr]}
    _ddb().put_item(TableName=TABLE_NAME, Item=item)
    saved = _account_from_item(item)
    saved["updatedAt"] = now
    return saved, None


def _debt_signed_balance(kind, ledger_balance):
    """Convert a bank-reported ledger balance to the app's debt convention.
    Credit cards / loans report a positive amount-owed; the register tracks
    that as negative, so flip the sign for debt-nature accounts.
    # ponytail: assumes banks report debt balances positive (RBC does). If a
    # bank ever reports them already-negative, reconciliation will look off —
    # revisit with per-bank sign handling then."""
    if kind in DEBT_KINDS:
        return -abs(ledger_balance)
    return ledger_balance


def set_reconciled_balance(user_id, account_id, balance, as_of):
    """Record the bank-stated ledger balance from a statement import."""
    _ddb().update_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": f"BPF#ACCOUNT#{account_id}"}},
        UpdateExpression="SET reconciledBalance = :b, reconciledAt = :d, updatedAt = :n",
        ExpressionAttributeValues={
            ":b": {"N": str(float(balance))},
            ":d": {"S": str(as_of or "")},
            ":n": {"S": _now()},
        },
    )


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
        "transferId": item.get("transferId", {}).get("S", ""),
        "fitid": item.get("fitid", {}).get("S", ""),
        "updatedAt": item.get("updatedAt", {}).get("S", ""),
        "source": "local",
    }


def _is_transfer(txn):
    """Transfer legs move money between own accounts — never income/spend."""
    return bool(txn.get("transferId")) or txn.get("category") == "Transfer"


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


def _txn_item(user_id, sk, clean, transfer_id="", fitid="", now=None):
    item = {
        "PK": {"S": f"USER#{user_id}"},
        "SK": {"S": sk},
        "accountId": {"S": clean["accountId"]},
        "amount": {"N": str(clean["amount"])},
        "payee": {"S": clean["payee"]},
        "category": {"S": clean["category"]},
        "notes": {"S": clean["notes"]},
        "business": {"BOOL": False},  # phase-2 hook, always false in P1
        "updatedAt": {"S": now or _now()},
    }
    if transfer_id:
        item["transferId"] = {"S": transfer_id}
    if fitid:
        item["fitid"] = {"S": fitid}
    return item


def _put_txn(user_id, sk, clean, transfer_id="", fitid=""):
    now = _now()
    _ddb().put_item(TableName=TABLE_NAME,
                    Item=_txn_item(user_id, sk, clean, transfer_id, fitid, now))
    return now


def _batch_put(items):
    """BatchWriteItem in chunks of 25 with unprocessed-item retries."""
    ddb = _ddb()
    for i in range(0, len(items), 25):
        request = {TABLE_NAME: [{"PutRequest": {"Item": it}} for it in items[i:i + 25]]}
        for _ in range(5):
            resp = ddb.batch_write_item(RequestItems=request)
            request = resp.get("UnprocessedItems") or {}
            if not request.get(TABLE_NAME):
                break


def _find_transfer_sibling(user_id, transfer_id, exclude_sk):
    """The other leg of a transfer. ponytail: prefix scan; fine at personal volumes."""
    for item in _query_prefix(user_id, "BPF#TXN#"):
        if (item.get("transferId", {}).get("S") == transfer_id
                and item["SK"]["S"] != exclude_sk):
            return item
    return None


def save_transaction(user_id, data, txn_id=None, fitid=""):
    """Create or update. Date changes move the item (SK embeds date).
    Editing a transfer leg mirrors amount/date onto its sibling. Returns (txn, error)."""
    clean, err = _validate_txn(data)
    if err:
        return None, err
    transfer_id = ""
    if not txn_id and clean["category"] == "Other":
        # no explicit category — let the user's payee rules pick one
        from api.bpf_rules import apply_rules, get_rules
        clean["category"] = apply_rules(get_rules(user_id), clean["payee"]) or "Other"
    if txn_id:
        old_sk = _txn_sk(txn_id)
        if not old_sk:
            return None, "invalid transaction id"
        resp = _ddb().get_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": old_sk}},
        )
        old = resp.get("Item") or {}
        transfer_id = old.get("transferId", {}).get("S", "")
        fitid = fitid or old.get("fitid", {}).get("S", "")
        if transfer_id:
            clean["category"] = "Transfer"  # legs stay transfers
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
    now = _put_txn(user_id, sk, clean, transfer_id, fitid)
    if transfer_id:
        sib = _find_transfer_sibling(user_id, transfer_id, sk)
        if sib:
            sib_txn = _txn_from_item(sib)
            mirrored = {**sib_txn, "date": clean["date"], "amount": -clean["amount"],
                        "category": "Transfer"}
            sib_uuid = sib["SK"]["S"].split("#")[-1]
            new_sib_sk = f"BPF#TXN#{clean['date']}#{sib_uuid}"
            if new_sib_sk != sib["SK"]["S"]:
                _ddb().delete_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": sib["SK"]["S"]}},
                )
            _put_txn(user_id, new_sib_sk, mirrored, transfer_id,
                     sib.get("fitid", {}).get("S", ""))
    else:
        _ensure_category(user_id, clean["category"])
    return {**clean, "id": new_id, "business": False, "transferId": transfer_id,
            "updatedAt": now, "source": "local"}, None


def delete_transaction(user_id, txn_id):
    """Delete a transaction; a transfer leg takes its sibling with it."""
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
    transfer_id = resp["Item"].get("transferId", {}).get("S", "")
    if transfer_id:
        sib = _find_transfer_sibling(user_id, transfer_id, sk)
        if sib:
            _ddb().delete_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": sib["SK"]["S"]}},
            )
    return True


def create_transfer(user_id, data):
    """Record money moving between two own accounts as linked legs.
    {date, amount (positive), fromAccountId, toAccountId, notes} -> (legs, error)."""
    d = str(data.get("date") or "").strip()[:10]
    try:
        datetime.strptime(d, "%Y-%m-%d")
    except ValueError:
        return None, "date must be YYYY-MM-DD"
    try:
        amount = abs(float(data.get("amount")))
    except (TypeError, ValueError):
        return None, "amount must be a number"
    if amount == 0:
        return None, "amount must be non-zero"
    src = str(data.get("fromAccountId") or "").strip()
    dst = str(data.get("toAccountId") or "").strip()
    if not src or not dst or src == dst:
        return None, "fromAccountId and toAccountId must be two different accounts"
    names = {a["id"]: a["displayName"] for a in list_accounts(user_id, txns=[])}
    if src not in names or dst not in names:
        return None, "account not found"
    notes = str(data.get("notes") or "").strip()
    transfer_id = uuid.uuid4().hex
    legs = []
    for account_id, amt, payee in (
        (src, -amount, f"Transfer to {names[dst]}"),
        (dst, amount, f"Transfer from {names[src]}"),
    ):
        u = uuid.uuid4().hex
        sk = f"BPF#TXN#{d}#{u}"
        clean = {"date": d, "amount": amt, "accountId": account_id,
                 "payee": payee, "category": "Transfer", "notes": notes}
        now = _put_txn(user_id, sk, clean, transfer_id)
        legs.append({**clean, "id": f"{d}_{u}", "business": False,
                     "transferId": transfer_id, "updatedAt": now, "source": "local"})
    return legs, None


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
        if t["amount"] < 0 and not _is_transfer(t):
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
    """Dashboard: accounts (local ∪ Era), net worth, 30-day cash flow, 90-day series.
    Transfer legs cancel out in the net series but are excluded from income/spend."""
    accounts = list_accounts(user_id) + era_client.get_accounts()
    net_worth = round(sum(a["balance"] for a in accounts), 2)
    today = date.today()
    d90 = (today - timedelta(days=90)).isoformat()
    d30 = (today - timedelta(days=30)).isoformat()
    txns = list_transactions(user_id, from_date=d90, to_date=today.isoformat())
    txns += era_client.get_transactions(from_date=d90, to_date=today.isoformat())
    flows = [t for t in txns if not _is_transfer(t)]
    income = sum(t["amount"] for t in flows if t["date"] >= d30 and t["amount"] > 0)
    spend = sum(-t["amount"] for t in flows if t["date"] >= d30 and t["amount"] < 0)
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
            if t["amount"] < 0 and not _is_transfer(t):
                out[t["category"]] = round(out.get(t["category"], 0.0) - t["amount"], 2)
        return out

    cur = [t for t in list_transactions(user_id, from_date=p_start, to_date=p_end)
           if not _is_transfer(t)]
    prev = [t for t in list_transactions(user_id, from_date=q_start, to_date=q_end)
            if not _is_transfer(t)]

    # ponytail: naive projection — avg net flow of last 3 months forward 3;
    # revisit if Adam wants Era's forecast surface to drive it.
    f_start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    f_start = (f_start - timedelta(days=1)).replace(day=1)
    hist = [t for t in list_transactions(user_id, from_date=f_start.isoformat(),
                                         to_date=today.isoformat()) if not _is_transfer(t)]
    months = max(1, (today.year - f_start.year) * 12 + today.month - f_start.month + 1)
    avg_net = sum(t["amount"] for t in hist) / months
    forecast = []
    m = today
    for i in range(1, 4):
        nxt = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        forecast.append({"month": nxt.strftime("%Y-%m"), "projectedNet": round(avg_net, 2)})
        m = nxt

    from api.bpf_recurring import detect_recurring
    payload = {
        "period": period,
        "recurring": detect_recurring(list_transactions(user_id)),
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
# Statement imports (OFX/QFX, QIF, CSV) — parse/preview/commit with dedupe
# ------------------------------------------------------------------------------

def link_transfer_pairs(user_id, from_date=None, to_date=None):
    """Link opposite-sign equal-amount pairs across different accounts within
    3 days as transfers. Returns pairs linked. ponytail: O(n²) over the window."""
    txns = [t for t in list_transactions(user_id, from_date, to_date)
            if not t["transferId"] and t["category"] != "Transfer" and t["accountId"]]
    txns.sort(key=lambda t: t["date"])
    linked, used = 0, set()
    for i, t in enumerate(txns):
        if t["id"] in used or t["amount"] >= 0:
            continue
        for u in txns:
            if (u["id"] in used or u["id"] == t["id"] or u["amount"] != -t["amount"]
                    or u["accountId"] == t["accountId"]):
                continue
            gap = abs((datetime.strptime(u["date"], "%Y-%m-%d")
                       - datetime.strptime(t["date"], "%Y-%m-%d")).days)
            if gap > 3:
                continue
            transfer_id = uuid.uuid4().hex
            for leg in (t, u):
                _ddb().update_item(
                    TableName=TABLE_NAME,
                    Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": _txn_sk(leg["id"])}},
                    UpdateExpression="SET transferId = :t, category = :c, updatedAt = :n",
                    ExpressionAttributeValues={
                        ":t": {"S": transfer_id},
                        ":c": {"S": "Transfer"},
                        ":n": {"S": _now()},
                    },
                )
            used.add(t["id"])
            used.add(u["id"])
            linked += 1
            break
    return linked


def import_statement(user_id, body, commit=False):
    """Parse an uploaded statement, dedupe against existing transactions,
    route rows by account number when possible, and (on commit) write rows,
    apply payee rules, link transfer pairs, and record ledger balances.
    Returns (result, error). Parse errors happen before any write; dedupe
    makes re-running a partially-committed file safe."""
    from api import bpf_import
    filename = str(body.get("filename") or "").strip()
    content = body.get("content")
    account_id = str(body.get("accountId") or "").strip()
    if not content or not isinstance(content, str):
        return None, "content (file text) is required"
    if not account_id:
        return None, "accountId (target account) is required"
    fmt = bpf_import.detect_format(filename, content)
    try:
        if fmt == "ofx":
            rows = bpf_import.parse_ofx(content)
        elif fmt == "qif":
            rows = bpf_import.parse_qif(content)
        else:
            mapping = body.get("mapping")
            if not isinstance(mapping, dict) or not mapping:
                return None, "mapping is required for CSV imports"
            rows = bpf_import.parse_csv(content, mapping)
    except ValueError as e:
        return None, str(e)
    if not rows:
        return None, "No transactions found in file"

    accounts = {a["id"]: a for a in list_accounts(user_id, txns=[])}
    if account_id not in accounts:
        return None, "Target account not found"
    number_to_account = {}
    for row in rows:
        n = row.get("accountNumber") or ""
        if n and n not in number_to_account:
            number_to_account[n] = find_account_by_number(user_id, n)

    lo = min(r["date"] for r in rows)
    hi = max(r["date"] for r in rows)
    existing = list_transactions(user_id, from_date=lo, to_date=hi)
    seen_fitids = {t["fitid"] for t in existing if t["fitid"]}
    seen_prints = {bpf_import.fingerprint(t["accountId"], t["date"], t["amount"], t["payee"])
                   for t in existing}

    from api.bpf_rules import apply_rules, get_rules
    rules = get_rules(user_id)
    new_rows, duplicates, routed = [], 0, {}
    for row in rows:
        target = number_to_account.get(row.get("accountNumber") or "") or account_id
        fp = bpf_import.fingerprint(target, row["date"], row["amount"], row["payee"])
        if (row.get("fitid") and row["fitid"] in seen_fitids) or fp in seen_prints:
            duplicates += 1
            continue
        seen_prints.add(fp)
        if row.get("fitid"):
            seen_fitids.add(row["fitid"])
        category = (row.get("category") or "").strip() \
            or apply_rules(rules, row["payee"]) or "Other"
        new_rows.append({"target": target, "category": category, **row})
        routed[target] = routed.get(target, 0) + 1

    result = {
        "format": fmt,
        "total": len(rows),
        "new": len(new_rows),
        "duplicates": duplicates,
        "routed": routed,
        "committed": False,
    }
    if not commit:
        return result, None

    items = []
    for row in new_rows:
        u = uuid.uuid4().hex
        clean = {"date": row["date"], "amount": row["amount"], "accountId": row["target"],
                 "payee": row["payee"], "category": row["category"], "notes": ""}
        items.append(_txn_item(user_id, f"BPF#TXN#{row['date']}#{u}", clean,
                               fitid=row.get("fitid") or ""))
    _batch_put(items)
    # bank-stated ledger balances → one reconciliation per statement/account
    reconciled = set()
    for row in rows:
        if row.get("ledgerBalance") is None:
            continue
        target = number_to_account.get(row.get("accountNumber") or "") or account_id
        key = (target, row["ledgerBalance"], row.get("ledgerBalanceDate"))
        if key in reconciled:
            continue
        reconciled.add(key)
        set_reconciled_balance(
            user_id, target,
            _debt_signed_balance(accounts.get(target, {}).get("kind", ""), row["ledgerBalance"]),
            row.get("ledgerBalanceDate") or hi)
    if fmt == "csv" and isinstance(body.get("mapping"), dict):
        # remember the mapping on the target account for next time
        _ddb().update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": f"BPF#ACCOUNT#{account_id}"}},
            UpdateExpression="SET csvMapping = :m",
            ExpressionAttributeValues={":m": {"S": json.dumps(body["mapping"])}},
        )
    result["committed"] = True
    result["transfersLinked"] = link_transfer_pairs(user_id, from_date=lo, to_date=hi)
    return result, None


def bulk_categorize(user_id, txn_ids, category):
    """Set the category on many transactions at once. Transfer legs are
    skipped (they stay 'Transfer'). Returns (updated_count, error)."""
    category = str(category or "").strip()
    if not category or category == "Transfer":
        return None, "category is required (and cannot be Transfer)"
    if not isinstance(txn_ids, list) or not txn_ids:
        return None, "ids must be a non-empty array"
    now = _now()
    updated = 0
    for txn_id in txn_ids[:200]:  # sanity cap; pages are <=50 rows
        sk = _txn_sk(str(txn_id))
        if not sk:
            continue
        try:
            _ddb().update_item(
                TableName=TABLE_NAME,
                Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": sk}},
                UpdateExpression="SET category = :c, updatedAt = :n",
                ConditionExpression="attribute_exists(SK) AND attribute_not_exists(transferId)",
                ExpressionAttributeValues={":c": {"S": category}, ":n": {"S": now}},
            )
            updated += 1
        except Exception:
            # missing row or transfer leg — skip, keep going
            continue
    if updated:
        _ensure_category(user_id, category)
    return updated, None


def apply_rules_to_uncategorized(user_id):
    """Re-run the user's payee rules over transactions still in 'Other'.
    Returns the number recategorized."""
    from api.bpf_rules import apply_rules, get_rules
    rules = get_rules(user_id)
    if not rules:
        return 0
    updated = 0
    for t in list_transactions(user_id):
        if t["category"] != "Other" or _is_transfer(t):
            continue
        category = apply_rules(rules, t["payee"])
        if not category:
            continue
        _ddb().update_item(
            TableName=TABLE_NAME,
            Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": _txn_sk(t["id"])}},
            UpdateExpression="SET category = :c, updatedAt = :n",
            ExpressionAttributeValues={":c": {"S": category}, ":n": {"S": _now()}},
        )
        updated += 1
    return updated


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
