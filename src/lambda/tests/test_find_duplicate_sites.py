import importlib.util
from pathlib import Path

_p = Path(__file__).resolve().parents[3] / "scripts" / "find_duplicate_sites.py"
_spec = importlib.util.spec_from_file_location("find_duplicate_sites", _p)
fds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fds)


def test_groups_only_true_duplicates_under_gate_rules():
    sites = [
        {"PK": "SITE#1", "url": "https://openclaw.ai"},
        {"PK": "SITE#2", "url": "http://www.OpenClaw.ai/"},
        {"PK": "SITE#3", "url": "openclaw.ai/docs"},
        {"PK": "SITE#4", "url": "https://x.com/a?b=1"},
        {"PK": "SITE#5", "url": "https://x.com/a"},
        {"PK": "SITE#6", "url": ""},
        {"PK": "SITE#7"},
    ]
    d = fds.group_duplicates(sites)
    assert list(d) == ["openclaw.ai"]
    assert [s["PK"] for s in d["openclaw.ai"]] == ["SITE#1", "SITE#2"]


def test_discover_api_base_parses_config_js(monkeypatch):
    monkeypatch.setattr(fds, "_get", lambda url: 'window.API_BASE_URL = "https://abc.execute-api.us-east-1.amazonaws.com/";')
    assert fds.discover_api_base("https://funkedupshift.com") == "https://abc.execute-api.us-east-1.amazonaws.com"


def test_discover_api_base_rejects_placeholder(monkeypatch):
    monkeypatch.setattr(fds, "_get", lambda url: 'window.API_BASE_URL = "API_URL_PLACEHOLDER";')
    import pytest
    with pytest.raises(RuntimeError):
        fds.discover_api_base("https://funkedupshift.com")


def _run_main(monkeypatch, body, argv=("--api-base", "https://api.test")):
    import json
    import sys as _sys
    monkeypatch.setattr(fds, "_get", lambda url: json.dumps(body))
    monkeypatch.setattr(_sys, "argv", ["find_duplicate_sites.py", *argv])
    return fds.main()


def test_main_exit_codes(monkeypatch, capsys):
    dup = {"sites": [{"PK": "SITE#1", "url": "a.com"}, {"PK": "SITE#2", "url": "https://www.a.com/"}]}
    assert _run_main(monkeypatch, dup) == 1
    assert "1 duplicate group" in capsys.readouterr().out
    assert _run_main(monkeypatch, {"sites": [{"PK": "SITE#1", "url": "a.com"}]}) == 0


def test_main_treats_error_body_and_empty_list_as_errors(monkeypatch, capsys):
    # listSites can return 200 with an error key; that must not read as "no duplicates"
    assert _run_main(monkeypatch, {"sites": [], "error": "TABLE_NAME not set"}) == 2
    assert _run_main(monkeypatch, {"sites": []}) == 2
    assert _run_main(monkeypatch, {"nope": 1}) == 2
    assert "unusable /sites response" in capsys.readouterr().err
