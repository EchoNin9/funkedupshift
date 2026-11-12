"""
Personal Finances (B&PF, FUNK-30): per-user payee -> category rules.

Single DynamoDB item per user (PK USER#{id}, SK BPF#RULES) holding an ordered
list of rules; list order is priority (first match wins). Each rule carries a
`source` attribute ("manual" today) as the hook for future AI-suggested rules.

Intentionally standalone: no imports from other api modules.
"""
import logging
import os
from datetime import datetime, timezone

from api import bpf_crypto

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

MATCH_MODES = ("contains", "starts_with", "equals")


def _ddb():
    import boto3
    return boto3.client("dynamodb")


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def get_rules(user_id):
    """Ordered list of {match, pattern, category, source} dicts (empty if none)."""
    resp = _ddb().get_item(
        TableName=TABLE_NAME,
        Key={"PK": {"S": f"USER#{user_id}"}, "SK": {"S": "BPF#RULES"}},
    )
    if "Item" not in resp:
        return []
    typed = resp["Item"].get("rules")
    if typed is None:
        return []
    # encrypted JSON string (FUNK-78) or legacy typed list of maps
    stored = bpf_crypto.dec_json(user_id, f"USER#{user_id}", "BPF#RULES", "rules", typed) or []
    return [{
        "match": mm.get("match", "contains"),
        "pattern": mm.get("pattern", ""),
        "category": mm.get("category", ""),
        "source": mm.get("source", "manual"),
    } for mm in stored]


def save_rules(user_id, rules):
    """Replace the user's rules (order = priority). Returns (clean_list, error)."""
    if not isinstance(rules, list):
        return None, "rules must be an array"
    clean = []
    for r in rules:
        if not isinstance(r, dict):
            return None, "each rule must be an object"
        match = str(r.get("match") or "").strip()
        if match not in MATCH_MODES:
            return None, f"match must be one of: {', '.join(MATCH_MODES)}"
        pattern = str(r.get("pattern") or "").strip()
        if not pattern:
            return None, "each rule needs a pattern"
        category = str(r.get("category") or "").strip()
        if not category:
            return None, "each rule needs a category"
        source = str(r.get("source") or "manual").strip() or "manual"
        clean.append({"match": match, "pattern": pattern,
                      "category": category, "source": source})
    _ddb().put_item(
        TableName=TABLE_NAME,
        Item={
            "PK": {"S": f"USER#{user_id}"},
            "SK": {"S": "BPF#RULES"},
            "rules": bpf_crypto.enc_attr(user_id, f"USER#{user_id}", "BPF#RULES", "rules", clean),
            "updatedAt": {"S": _now()},
        },
    )
    return clean, None


def apply_rules(rules, payee):
    """First matching rule's category, or None. Case-insensitive on payee. Pure."""
    p = str(payee or "").lower()
    for r in rules:
        pattern = str(r.get("pattern") or "").lower()
        if not pattern:
            continue
        match = r.get("match")
        if match == "contains" and pattern in p:
            return r["category"]
        if match == "starts_with" and p.startswith(pattern):
            return r["category"]
        if match == "equals" and p == pattern:
            return r["category"]
    return None
