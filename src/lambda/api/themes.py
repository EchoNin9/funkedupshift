"""Themes CRUD, site settings, and profile theme/mode/pins helpers.

Items live in the main table:
  theme          PK="THEME", SK="THEME#<id>"
  site settings  PK="SITE",  SK="SETTINGS"
  seed marker    PK="SITE",  SK="THEMES_SEEDED"
"""
import json
import logging
import math
import os
import random
import re
import string
from datetime import datetime, timezone
from decimal import Decimal

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("TABLE_NAME", "")

MAX_BODY_BYTES = 16 * 1024
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
COLOR_FIELDS = ("accent", "discover", "tools", "modules", "admin")
MODES = ("dark", "light")
MAX_PINS = 50
MAX_PIN_LEN = 64
FALLBACK_THEME_ID = "funk"
FALLBACK_MODE = "dark"

SEED_THEMES = [
    ("funk", "Funk", 285, "#7c5cff", "#33c9aa", "#9a82ff", "#ff7f5c", "#f2b73f"),
    ("ember", "Ember", 45, "#ff6a3d", "#f2b73f", "#ff8fab", "#b18cff", "#5fd0a0"),
    ("lagoon", "Lagoon", 230, "#3d7bff", "#2ec4b6", "#8fa8ff", "#ffb454", "#ff7a93"),
    ("neon", "Neon", 150, "#a3e635", "#22d3ee", "#f472b6", "#facc15", "#fb923c"),
]
SEED_SETTINGS = {"defaultThemeId": "funk", "defaultMode": "dark"}

_table = None
_seeded = False


def _tbl():
    """Cached boto3 Table resource for the main table."""
    global _table
    if _table is None:
        if not TABLE_NAME:
            raise RuntimeError("TABLE_NAME not set")
        import boto3
        _table = boto3.resource("dynamodb").Table(TABLE_NAME)
    return _table


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _is_cond_failed(e):
    resp = getattr(e, "response", None) or {}
    return (resp.get("Error") or {}).get("Code") == "ConditionalCheckFailedException"


def _put_if_absent(item):
    """Conditional put; True if written, False if the key already existed."""
    try:
        _tbl().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
        return True
    except Exception as e:
        if _is_cond_failed(e):
            return False
        raise


def _theme_item(theme_id, name, tint, colors, builtin):
    item = {
        "PK": "THEME",
        "SK": f"THEME#{theme_id}",
        "id": theme_id,
        "name": name,
        "tint": tint,
        "builtin": bool(builtin),
        "updatedAt": _now(),
    }
    for f in COLOR_FIELDS:
        item[f] = colors[f]
    return item


def _public_theme(item):
    out = {k: item.get(k) for k in ("id", "name", "tint") + COLOR_FIELDS}
    out["builtin"] = bool(item.get("builtin"))
    out["updatedAt"] = item.get("updatedAt", "")
    return out


def seed():
    """Put-if-absent every theme and the settings, then the marker LAST.

    The marker is written last so a seed that dies midway is completed on the
    next call. Returns True if this call wrote the marker.
    """
    for (tid, name, tint, accent, discover, tools, modules, admin) in SEED_THEMES:
        colors = dict(accent=accent, discover=discover, tools=tools, modules=modules, admin=admin)
        _put_if_absent(_theme_item(tid, name, Decimal(str(tint)), colors, True))
    _put_if_absent({"PK": "SITE", "SK": "SETTINGS", **SEED_SETTINGS, "updatedAt": _now()})
    return _put_if_absent({"PK": "SITE", "SK": "THEMES_SEEDED", "seededAt": _now()})


def ensure_seeded():
    """Seed once per warm Lambda: zero writes in steady state, <=1 read per cold start."""
    global _seeded
    if _seeded:
        return False
    if _tbl().get_item(Key={"PK": "SITE", "SK": "THEMES_SEEDED"}).get("Item"):
        _seeded = True
        return False
    wrote = seed()
    _seeded = True
    return wrote


def _get_settings():
    item = _tbl().get_item(Key={"PK": "SITE", "SK": "SETTINGS"}).get("Item") or {}
    return {
        "defaultThemeId": item.get("defaultThemeId") or SEED_SETTINGS["defaultThemeId"],
        "defaultMode": item.get("defaultMode") or SEED_SETTINGS["defaultMode"],
    }


def theme_exists(theme_id):
    if not isinstance(theme_id, str) or not ID_RE.match(theme_id):
        return False
    ensure_seeded()
    resp = _tbl().get_item(Key={"PK": "THEME", "SK": f"THEME#{theme_id}"})
    return bool(resp.get("Item"))


MAX_COLLAPSED_GROUPS = 20
MAX_COLLAPSED_GROUP_LEN = 32


def resolve_profile_prefs(stored_theme_id, stored_mode):
    """Return (themeId, mode) resolved against the themes table; never raises."""
    theme_id, mode = FALLBACK_THEME_ID, FALLBACK_MODE
    try:
        ensure_seeded()
        settings = _get_settings()
        theme_id = settings["defaultThemeId"]
        mode = settings["defaultMode"]
        if stored_theme_id and theme_exists(stored_theme_id):
            theme_id = stored_theme_id
    except Exception as e:
        logger.warning("resolve_profile_prefs failed: %s", e)
    if stored_mode in MODES:
        mode = stored_mode
    return theme_id, mode


def validate_profile_prefs(body):
    """Validate optional pins/collapsedGroups/themeId/mode. Returns (prefs, error).

    prefs only has keys present in body; themeId None means REMOVE.
    """
    prefs = {}
    if "pins" in body:
        pins = body["pins"]
        if not isinstance(pins, list):
            return None, "pins must be a list"
        if len(pins) > MAX_PINS:
            return None, f"pins must have at most {MAX_PINS} entries"
        out = []
        for p in pins:
            if not isinstance(p, str):
                return None, "pins must be strings"
            p = p.strip()
            if not 1 <= len(p) <= MAX_PIN_LEN:
                return None, f"each pin must be 1-{MAX_PIN_LEN} characters"
            if p not in out:
                out.append(p)
        prefs["pins"] = out
    if "collapsedGroups" in body:
        groups = body["collapsedGroups"]
        if not isinstance(groups, list):
            return None, "collapsedGroups must be a list"
        if len(groups) > MAX_COLLAPSED_GROUPS:
            return None, f"collapsedGroups must have at most {MAX_COLLAPSED_GROUPS} entries"
        out = []
        for g in groups:
            if not isinstance(g, str):
                return None, "collapsedGroups must be strings"
            g = g.strip()
            if not 1 <= len(g) <= MAX_COLLAPSED_GROUP_LEN:
                return None, f"each collapsed group must be 1-{MAX_COLLAPSED_GROUP_LEN} characters"
            if g not in out:
                out.append(g)
        prefs["collapsedGroups"] = out
    if "mode" in body:
        if body["mode"] not in MODES:
            return None, "mode must be 'dark' or 'light'"
        prefs["mode"] = body["mode"]
    if "themeId" in body:
        tid = body["themeId"]
        if tid is None:
            prefs["themeId"] = None
        elif not isinstance(tid, str) or not theme_exists(tid):
            return None, "Unknown themeId"
        else:
            prefs["themeId"] = tid
    return prefs, None


# ---- request helpers ----

def _parse_body(event):
    raw = event.get("body") or "{}"
    if isinstance(raw, str):
        if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
            return None, "Request body too large"
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return None, "Invalid JSON body"
    else:
        return None, "Invalid JSON body"
    if not isinstance(data, dict):
        return None, "Body must be a JSON object"
    return data, None


def _validate_theme_fields(body):
    name = body.get("name")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
        return None, "name must be 1-40 characters"
    tint = body.get("tint")
    if isinstance(tint, bool) or not isinstance(tint, (int, float, Decimal)):
        return None, "tint must be a number between 0 and 360"
    try:
        f = float(tint)
    except (ValueError, OverflowError):
        return None, "tint must be a number between 0 and 360"
    if math.isnan(f) or math.isinf(f) or not 0 <= f <= 360:
        return None, "tint must be a number between 0 and 360"
    fields = {"name": name.strip(), "tint": Decimal(str(tint))}
    for c in COLOR_FIELDS:
        v = body.get(c)
        if not isinstance(v, str) or not COLOR_RE.match(v):
            return None, f"{c} must be a hex colour like #aabbcc"
        fields[c] = v
    return fields, None


def _slugify(name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:36].strip("-")
    return slug or "theme"


# ---- route functions ----

def list_themes(jsonResponse):
    ensure_seeded()
    items = []
    kwargs = {"KeyConditionExpression": _key_eq("THEME")}
    while True:
        resp = _tbl().query(**kwargs)
        items.extend(resp.get("Items", []))
        if not resp.get("LastEvaluatedKey"):
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]
    themes = [_public_theme(i) for i in items]
    themes.sort(key=lambda t: (not t["builtin"], (t["name"] or "").lower()))
    return jsonResponse({"themes": themes, "defaultThemeId": _get_settings()["defaultThemeId"]})


def _key_eq(pk):
    from boto3.dynamodb.conditions import Key
    return Key("PK").eq(pk)


def get_theme(jsonResponse, theme_id):
    ensure_seeded()
    item = _tbl().get_item(Key={"PK": "THEME", "SK": f"THEME#{theme_id}"}).get("Item")
    if not item:
        return jsonResponse({"error": "Theme not found"}, 404)
    return jsonResponse(_public_theme(item))


def create_theme(event, jsonResponse):
    body, err = _parse_body(event)
    if err:
        return jsonResponse({"error": err}, 400)
    fields, err = _validate_theme_fields(body)
    if err:
        return jsonResponse({"error": err}, 400)
    explicit = body.get("id")
    if explicit is not None and (not isinstance(explicit, str) or not ID_RE.match(explicit)):
        return jsonResponse({"error": "id must match [a-z0-9-], 1-40 characters"}, 400)
    ensure_seeded()
    colors = {c: fields[c] for c in COLOR_FIELDS}
    if explicit:
        item = _theme_item(explicit, fields["name"], fields["tint"], colors, False)
        if not _put_if_absent(item):
            return jsonResponse({"error": "Theme id already exists"}, 409)
        return jsonResponse(_public_theme(item), 201)
    alphabet = string.ascii_lowercase + string.digits
    for _ in range(10):
        tid = _slugify(fields["name"]) + "-" + "".join(random.choice(alphabet) for _ in range(3))
        item = _theme_item(tid, fields["name"], fields["tint"], colors, False)
        if _put_if_absent(item):
            return jsonResponse(_public_theme(item), 201)
    return jsonResponse({"error": "Could not generate a unique theme id"}, 409)


def update_theme(event, jsonResponse, theme_id):
    body, err = _parse_body(event)
    if err:
        return jsonResponse({"error": err}, 400)
    if "id" in body and body["id"] != theme_id:
        return jsonResponse({"error": "Theme id cannot be changed"}, 400)
    fields, err = _validate_theme_fields(body)
    if err:
        return jsonResponse({"error": err}, 400)
    ensure_seeded()
    existing = _tbl().get_item(Key={"PK": "THEME", "SK": f"THEME#{theme_id}"}).get("Item")
    if not existing:
        return jsonResponse({"error": "Theme not found"}, 404)
    colors = {c: fields[c] for c in COLOR_FIELDS}
    item = _theme_item(theme_id, fields["name"], fields["tint"], colors, existing.get("builtin"))
    _tbl().put_item(Item=item)
    return jsonResponse(_public_theme(item))


def delete_theme(jsonResponse, theme_id):
    ensure_seeded()
    existing = _tbl().get_item(Key={"PK": "THEME", "SK": f"THEME#{theme_id}"}).get("Item")
    if not existing:
        return jsonResponse({"error": "Theme not found"}, 404)
    if _get_settings()["defaultThemeId"] == theme_id:
        return jsonResponse({"error": "Cannot delete the site default theme"}, 409)
    _tbl().delete_item(Key={"PK": "THEME", "SK": f"THEME#{theme_id}"})
    return jsonResponse({"deleted": theme_id})


def get_site_settings(jsonResponse):
    ensure_seeded()
    return jsonResponse(_get_settings())


def update_site_settings(event, jsonResponse):
    body, err = _parse_body(event)
    if err:
        return jsonResponse({"error": err}, 400)
    if "defaultThemeId" not in body and "defaultMode" not in body:
        return jsonResponse({"error": "defaultThemeId or defaultMode is required"}, 400)
    ensure_seeded()
    settings = _get_settings()
    if "defaultThemeId" in body:
        tid = body["defaultThemeId"]
        if not isinstance(tid, str) or not theme_exists(tid):
            return jsonResponse({"error": "Unknown defaultThemeId"}, 400)
        settings["defaultThemeId"] = tid
    if "defaultMode" in body:
        if body["defaultMode"] not in MODES:
            return jsonResponse({"error": "defaultMode must be 'dark' or 'light'"}, 400)
        settings["defaultMode"] = body["defaultMode"]
    _tbl().put_item(Item={"PK": "SITE", "SK": "SETTINGS", **settings, "updatedAt": _now()})
    return jsonResponse(settings)
