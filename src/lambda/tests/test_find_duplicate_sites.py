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
