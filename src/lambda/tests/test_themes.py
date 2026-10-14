"""Tests for themes CRUD, site settings, and profile pins/themeId/mode."""
import json
import re
import sys
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api import handler, themes  # noqa: E402


class FakeTable:
    """In-memory table: get/put(attribute_not_exists)/delete/query, recording writes."""

    def __init__(self):
        self.items = {}
        self.puts = []

    def get_item(self, Key, **kw):
        it = self.items.get((Key["PK"], Key["SK"]))
        return {"Item": dict(it)} if it else {}

    def put_item(self, Item, ConditionExpression=None, **kw):
        k = (Item["PK"], Item["SK"])
        if ConditionExpression == "attribute_not_exists(PK)" and k in self.items:
            raise ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "PutItem")
        self.puts.append(dict(Item))
        self.items[k] = dict(Item)
        return {}

    def delete_item(self, Key, **kw):
        self.items.pop((Key["PK"], Key["SK"]), None)
        return {}

    def query(self, KeyConditionExpression, **kw):
        pk = KeyConditionExpression.get_expression()["values"][1]
        return {"Items": [dict(v) for (p, _), v in sorted(self.items.items()) if p == pk]}

    def scan(self, **kw):
        return {"Items": [dict(v) for v in self.items.values()]}


@pytest.fixture(autouse=True)
def _reset_seeded():
    themes._seeded = False
    yield
    themes._seeded = False


@pytest.fixture
def tbl():
    t = FakeTable()
    with patch("api.themes._tbl", return_value=t):
        yield t


def _ev(path, method="GET", body=None, groups=None, raw=None):
    claims = None
    if groups is not None:
        claims = {"sub": "u1", "email": "u@example.com", "cognito:groups": groups}
    rc = {"http": {"method": method, "path": path}}
    if claims:
        rc["authorizer"] = {"jwt": {"claims": claims}}
    return {
        "rawPath": path,
        "pathParameters": {},
        "requestContext": rc,
        "body": raw if raw is not None else (json.dumps(body) if body is not None else "{}"),
    }


def _call(ev):
    with patch("api.handler.getEffectiveUserInfo", side_effect=_fake_user(ev)):
        r = handler.handler(ev, None)
    return r["statusCode"], json.loads(r["body"])


def _fake_user(ev):
    claims = ev["requestContext"].get("authorizer", {}).get("jwt", {}).get("claims")

    def f(_event):
        if not claims:
            return {"userId": "", "groups": []}
        return {"userId": claims["sub"], "email": claims["email"],
                "groups": [g for g in claims["cognito:groups"].split(",") if g]}
    return f


def _theme_body(**over):
    b = {"name": "Sunset", "tint": 20, "accent": "#ff0000", "discover": "#00ff00",
         "tools": "#0000ff", "modules": "#aabbcc", "admin": "#112233"}
    b.update(over)
    return b


# ---- public reads / seeding ----

def test_guest_get_themes_and_settings(tbl):
    code, body = _call(_ev("/themes"))
    assert code == 200
    assert [t["id"] for t in body["themes"]] == ["ember", "funk", "lagoon", "neon"]
    assert body["defaultThemeId"] == "funk"
    assert isinstance(body["themes"][0]["tint"], (int, float))
    code, body = _call(_ev("/site-settings"))
    assert code == 200 and body == {"defaultThemeId": "funk", "defaultMode": "dark"}


def test_guest_get_theme_by_id_and_404(tbl):
    code, body = _call(_ev("/themes/neon"))
    assert code == 200 and body["id"] == "neon" and body["builtin"] is True
    code, _ = _call(_ev("/themes/nope"))
    assert code == 404


def test_seed_items_use_decimal_tint(tbl):
    themes.seed()
    seeded = [p for p in tbl.puts if p["PK"] == "THEME"]
    assert len(seeded) == 4
    for p in seeded:
        assert isinstance(p["tint"], Decimal) and not isinstance(p["tint"], float)
        assert p["builtin"] is True


def test_double_seed_no_dupes_no_clobber_no_resurrect(tbl):
    assert themes.seed() is True
    n = len(tbl.items)
    tbl.items[("THEME", "THEME#ember")]["name"] = "Edited"
    del tbl.items[("THEME", "THEME#neon")]
    assert themes.ensure_seeded() is False
    assert themes.ensure_seeded() is False
    assert len(tbl.items) == n - 1
    assert tbl.items[("THEME", "THEME#ember")]["name"] == "Edited"
    assert ("THEME", "THEME#neon") not in tbl.items


def test_marker_error_other_than_conditional_raises():
    t = MagicMock()
    t.put_item.side_effect = ClientError({"Error": {"Code": "ProvisionedThroughputExceededException"}}, "PutItem")
    with patch("api.themes._tbl", return_value=t):
        with pytest.raises(ClientError):
            themes.seed()


# ---- auth ----

@pytest.mark.parametrize("method,path", [
    ("POST", "/themes"), ("PUT", "/themes/funk"), ("DELETE", "/themes/funk"), ("PUT", "/site-settings"),
])
def test_write_routes_guest_401_user_403(tbl, method, path):
    body = _theme_body() if "themes" in path else {"defaultMode": "light"}
    code, _ = _call(_ev(path, method, body))
    assert code == 401
    code, _ = _call(_ev(path, method, body, groups="user"))
    assert code == 403
    assert tbl.puts == []


# ---- create ----

def test_create_generated_id_decimal(tbl):
    code, body = _call(_ev("/themes", "POST", _theme_body(name="  Sun Set!  ", tint=20.5), groups="admin"))
    assert code == 201
    assert re.match(r"^sun-set-[a-z0-9]{3}$", body["id"])
    assert body["name"] == "Sun Set!" and body["builtin"] is False and body["tint"] == 20.5
    item = tbl.items[("THEME", f"THEME#{body['id']}")]
    assert isinstance(item["tint"], Decimal) and not isinstance(item["tint"], float)


def test_create_explicit_id_and_duplicate_409(tbl):
    code, body = _call(_ev("/themes", "POST", _theme_body(id="sunset"), groups="admin"))
    assert code == 201 and body["id"] == "sunset"
    code, _ = _call(_ev("/themes", "POST", _theme_body(id="sunset"), groups="admin"))
    assert code == 409
    code, _ = _call(_ev("/themes", "POST", _theme_body(id="funk"), groups="admin"))
    assert code == 409


@pytest.mark.parametrize("over", [
    {"name": ""}, {"name": "   "}, {"name": "x" * 41}, {"name": 5},
    {"tint": -1}, {"tint": 361}, {"tint": True}, {"tint": "20"}, {"tint": float("nan")},
    {"accent": "#fff"}, {"accent": "red"}, {"modules": "#gggggg"}, {"admin": None},
    {"id": "Bad Id"}, {"id": "x" * 41},
])
def test_create_invalid_400(tbl, over):
    code, body = _call(_ev("/themes", "POST", _theme_body(**over), groups="admin"))
    assert code == 400 and "error" in body


def test_create_missing_colour_400(tbl):
    b = _theme_body()
    del b["tools"]
    code, _ = _call(_ev("/themes", "POST", b, groups="admin"))
    assert code == 400


@pytest.mark.parametrize("raw", ["{not json", "[1,2]", '"str"', "{" + '"a":"' + "x" * 17000 + '"}'])
def test_create_bad_body_400(tbl, raw):
    code, _ = _call(_ev("/themes", "POST", raw=raw, groups="admin"))
    assert code == 400


# ---- update ----

def test_put_theme_replaces_keeps_builtin_decimal(tbl):
    code, body = _call(_ev("/themes/funk", "PUT", _theme_body(name="Funk2", tint=100), groups="admin"))
    assert code == 200 and body["name"] == "Funk2" and body["builtin"] is True and body["id"] == "funk"
    item = tbl.items[("THEME", "THEME#funk")]
    assert isinstance(item["tint"], Decimal) and not isinstance(item["tint"], float)
    assert item["accent"] == "#ff0000"


def test_put_theme_404_400_and_id_immutable(tbl):
    code, _ = _call(_ev("/themes/ghost", "PUT", _theme_body(), groups="admin"))
    assert code == 404
    code, _ = _call(_ev("/themes/funk", "PUT", _theme_body(id="other"), groups="admin"))
    assert code == 400
    code, _ = _call(_ev("/themes/funk", "PUT", _theme_body(id="funk"), groups="admin"))
    assert code == 200
    code, _ = _call(_ev("/themes/funk", "PUT", _theme_body(tint=999), groups="admin"))
    assert code == 400


# ---- delete ----

def test_delete_default_409_other_200_missing_404(tbl):
    code, body = _call(_ev("/themes/funk", "DELETE", groups="admin"))
    assert code == 409 and body["error"] == "Cannot delete the site default theme"
    code, body = _call(_ev("/themes/neon", "DELETE", groups="admin"))
    assert code == 200 and body == {"deleted": "neon"}
    code, _ = _call(_ev("/themes/neon", "DELETE", groups="admin"))
    assert code == 404
    # deleted built-in is not resurrected
    code, body = _call(_ev("/themes"))
    assert "neon" not in [t["id"] for t in body["themes"]]


# ---- site settings ----

def test_put_site_settings(tbl):
    code, body = _call(_ev("/site-settings", "PUT", {"defaultThemeId": "ember", "defaultMode": "light"}, groups="admin"))
    assert code == 200 and body == {"defaultThemeId": "ember", "defaultMode": "light"}
    code, body = _call(_ev("/site-settings", "PUT", {"defaultMode": "dark"}, groups="admin"))
    assert body == {"defaultThemeId": "ember", "defaultMode": "dark"}
    code, body = _call(_ev("/site-settings"))
    assert body["defaultThemeId"] == "ember"
    # can now delete former default, but not the new one
    assert _call(_ev("/themes/funk", "DELETE", groups="admin"))[0] == 200
    assert _call(_ev("/themes/ember", "DELETE", groups="admin"))[0] == 409


@pytest.mark.parametrize("body", [{}, {"defaultThemeId": "ghost"}, {"defaultMode": "blue"}, {"defaultThemeId": 5}])
def test_put_site_settings_invalid_400(tbl, body):
    assert _call(_ev("/site-settings", "PUT", body, groups="admin"))[0] == 400


# ---- profile ----

class FakeDynamo:
    def __init__(self, item=None):
        self.item = item
        self.updates = []

    def get_item(self, **kw):
        return {"Item": self.item} if self.item else {}

    def update_item(self, **kw):
        self.updates.append(kw)
        return {}


def _put_profile(tbl, body):
    fd = FakeDynamo()
    ev = _ev("/profile", "PUT", body, groups="user")
    with patch("api.handler.TABLE_NAME", "tbl"), patch("boto3.client", return_value=fd):
        code, out = _call(ev)
    return code, out, fd


def _get_profile(tbl, item):
    fd = FakeDynamo(item)
    ev = _ev("/profile", "GET", groups="user")
    with patch("api.handler.TABLE_NAME", "tbl"), patch("boto3.client", return_value=fd), \
            patch("api.handler._recordLastLogin"), patch("api.handler._getUserCustomGroups", return_value=[]):
        code, out = _call(ev)
    return code, out


def test_profile_put_description_only_unchanged(tbl):
    code, _, fd = _put_profile(tbl, {"description": "hi"})
    assert code == 200
    u = fd.updates[0]
    assert u["UpdateExpression"] == "SET updatedAt = :now, #desc = :desc"
    assert "REMOVE" not in u["UpdateExpression"]
    assert tbl.puts == []  # no theme table access when prefs absent


def test_profile_put_pins_mode_theme(tbl):
    code, _, fd = _put_profile(tbl, {"pins": [" a ", "b", "a", "b", "c"], "mode": "light", "themeId": "ember"})
    assert code == 200
    u = fd.updates[0]
    assert u["ExpressionAttributeValues"][":pins"] == {"L": [{"S": "a"}, {"S": "b"}, {"S": "c"}]}
    assert u["ExpressionAttributeValues"][":mode"] == {"S": "light"}
    assert u["ExpressionAttributeValues"][":tid"] == {"S": "ember"}
    assert u["ExpressionAttributeNames"]["#mode"] == "mode"
    assert "REMOVE" not in u["UpdateExpression"]


def test_profile_put_theme_null_removes(tbl):
    code, _, fd = _put_profile(tbl, {"themeId": None, "description": "x"})
    assert code == 200
    expr = fd.updates[0]["UpdateExpression"]
    assert expr.startswith("SET ") and expr.endswith(" REMOVE themeId")
    assert ":tid" not in fd.updates[0]["ExpressionAttributeValues"]


@pytest.mark.parametrize("body", [
    {"pins": ["x"] * 0 + [str(i) for i in range(51)]},
    {"pins": [1]}, {"pins": [""]}, {"pins": ["   "]}, {"pins": ["x" * 65]}, {"pins": "a"}, {"pins": None},
    {"mode": "blue"}, {"mode": None}, {"themeId": "ghost"}, {"themeId": 5},
])
def test_profile_put_invalid_400_no_write(tbl, body):
    code, _, fd = _put_profile(tbl, {"description": "ok", **body})
    assert code == 400
    assert fd.updates == []


def test_profile_pins_boundaries(tbl):
    assert _put_profile(tbl, {"pins": [str(i) for i in range(50)]})[0] == 200
    assert _put_profile(tbl, {"pins": ["x" * 64]})[0] == 200
    assert _put_profile(tbl, {"pins": []})[0] == 200


def test_profile_get_defaults_when_absent(tbl):
    code, out = _get_profile(tbl, None)
    p = out["profile"]
    assert code == 200 and p["pins"] == [] and p["themeId"] == "funk" and p["mode"] == "dark"


def test_profile_get_stored_values(tbl):
    item = {"description": {"S": "d"}, "pins": {"L": [{"S": "a"}, {"S": "b"}]},
            "themeId": {"S": "lagoon"}, "mode": {"S": "light"}}
    _, out = _get_profile(tbl, item)
    p = out["profile"]
    assert p["pins"] == ["a", "b"] and p["themeId"] == "lagoon" and p["mode"] == "light"
    assert p["description"] == "d"


def test_profile_deleted_theme_resolves_to_site_default(tbl):
    item = {"themeId": {"S": "neon"}}
    assert _get_profile(tbl, item)[1]["profile"]["themeId"] == "neon"
    assert _call(_ev("/themes/neon", "DELETE", groups="admin"))[0] == 200
    assert _get_profile(tbl, item)[1]["profile"]["themeId"] == "funk"
    _call(_ev("/site-settings", "PUT", {"defaultThemeId": "ember", "defaultMode": "light"}, groups="admin"))
    p = _get_profile(tbl, item)[1]["profile"]
    assert p["themeId"] == "ember" and p["mode"] == "light"


def test_profile_get_tolerates_themes_failure():
    with patch("api.themes._tbl", side_effect=RuntimeError("boom")):
        code, out = _get_profile(None, {"themeId": {"S": "x"}, "mode": {"S": "light"}})
    p = out["profile"]
    assert code == 200 and p["themeId"] == "funk" and p["mode"] == "light"


# ---- infra ----

def test_new_routes_in_infra():
    infra = (Path(__file__).resolve().parents[3] / "infra" / "main.tf").read_text()
    for rk in ["GET /themes", "POST /themes", "GET /themes/{id}", "PUT /themes/{id}",
               "DELETE /themes/{id}", "GET /site-settings", "PUT /site-settings"]:
        assert f'route_key          = "{rk}"' in infra or f'route_key = "{rk}"' in infra, rk


# ---- seeding robustness / perf ----

def test_ensure_seeded_second_call_makes_no_table_calls(tbl):
    assert themes.ensure_seeded() is True
    t = MagicMock()
    with patch("api.themes._tbl", return_value=t):
        assert themes.ensure_seeded() is False
    assert t.method_calls == []


def test_ensure_seeded_steady_state_cold_start_reads_only(tbl):
    themes.ensure_seeded()
    themes._seeded = False  # simulate a new warm container
    writes = len(tbl.puts)
    assert themes.ensure_seeded() is False
    assert len(tbl.puts) == writes  # marker present: no writes
    assert themes._seeded is True


def test_marker_written_last(tbl):
    themes.seed()
    assert tbl.puts[-1]["SK"] == "THEMES_SEEDED"


def test_marker_absent_themes_present_completes_without_clobber(tbl):
    themes.seed()
    del tbl.items[("SITE", "THEMES_SEEDED")]
    del tbl.items[("SITE", "SETTINGS")]
    tbl.items[("THEME", "THEME#ember")]["name"] = "Edited"
    assert themes.ensure_seeded() is True
    assert tbl.items[("THEME", "THEME#ember")]["name"] == "Edited"
    assert ("SITE", "SETTINGS") in tbl.items and ("SITE", "THEMES_SEEDED") in tbl.items
    assert len([k for k in tbl.items if k[0] == "THEME"]) == 4


def test_get_themes_serializes_tint_as_json_number(tbl):
    ev = _ev("/themes")
    with patch("api.handler.getEffectiveUserInfo", side_effect=_fake_user(ev)):
        r = handler.handler(ev, None)
    raw = json.loads(r["body"])["themes"]
    assert all(type(t["tint"]) in (int, float) for t in raw)
    assert '"tint": 285' in r["body"]


def test_profile_put_theme_null_only_has_valid_expression(tbl):
    code, _, fd = _put_profile(tbl, {"themeId": None})
    assert code == 200
    expr = fd.updates[0]["UpdateExpression"]
    assert expr == "SET updatedAt = :now REMOVE themeId"
