"""Unit tests for generate_description API and logic."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _admin_event(path, method="POST", body=None):
    """Event with admin JWT authorizer."""
    return {
        "rawPath": path,
        "requestContext": {
            "http": {"method": method, "path": path},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "admin-123",
                        "email": "admin@example.com",
                        "cognito:groups": "admin",
                    }
                }
            },
        },
        "body": json.dumps(body) if body is not None else "{}",
    }


def test_generateDescription_requires_auth():
    """POST /sites/generate-description without auth returns 401."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/generate-description",
        "requestContext": {"http": {"method": "POST", "path": "/sites/generate-description"}},
        "body": '{"url": "https://example.com"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 401


def test_generateDescription_requires_admin():
    """POST /sites/generate-description with non-admin returns 403."""
    from api.handler import handler
    event = {
        "rawPath": "/sites/generate-description",
        "requestContext": {
            "http": {"method": "POST", "path": "/sites/generate-description"},
            "authorizer": {
                "jwt": {
                    "claims": {
                        "sub": "user-123",
                        "email": "user@example.com",
                        "cognito:groups": "user",
                    }
                }
            },
        },
        "body": '{"url": "https://example.com"}',
    }
    result = handler(event, None)
    assert result["statusCode"] == 403


def test_generateDescription_missing_url_returns_400():
    """POST /sites/generate-description with empty url returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/generate-description", body={"url": ""})
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body
    assert "URL" in body["error"]


def test_generateDescription_invalid_json_returns_400():
    """POST /sites/generate-description with invalid JSON returns 400."""
    from api.handler import handler
    event = _admin_event("/sites/generate-description")
    event["body"] = "not valid json"
    result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body


def test_generateDescription_success_returns_description_and_flag():
    """POST /sites/generate-description with valid url returns description and aiGenerated."""
    from api.handler import handler
    mock_summary = "A useful website for developers."
    with patch("api.generate_description.generate_description") as mock_gen:
        mock_gen.return_value = {"description": mock_summary, "aiGenerated": True}
        event = _admin_event("/sites/generate-description", body={"url": "https://example.com"})
        result = handler(event, None)
    assert result["statusCode"] == 200
    body = json.loads(result["body"])
    assert body["description"] == mock_summary
    assert body["aiGenerated"] is True


def test_generateDescription_fetch_error_returns_400():
    """POST /sites/generate-description when fetch fails returns 400."""
    from api.handler import handler
    with patch("api.generate_description.generate_description") as mock_gen:
        mock_gen.return_value = {"error": "Could not fetch or extract content from URL"}
        event = _admin_event("/sites/generate-description", body={"url": "https://example.com"})
        result = handler(event, None)
    assert result["statusCode"] == 400
    body = json.loads(result["body"])
    assert "error" in body


def test_generate_description_empty_url():
    """generate_description with empty url returns error."""
    from api.generate_description import generate_description
    result = generate_description("")
    assert "error" in result
    assert "URL" in result["error"]


def test_extract_text_strips_scripts():
    """extract_text removes script and style tags."""
    from api.generate_description import extract_text
    html = "<html><body><script>alert(1)</script><p>Hello world</p></body></html>"
    text = extract_text(html)
    assert "alert" not in text
    assert "Hello" in text or "world" in text


def test_extract_text_caps_length():
    """extract_text truncates to MAX_CONTENT_CHARS."""
    from api.generate_description import extract_text, MAX_CONTENT_CHARS
    long_html = "<html><body><p>" + "x" * (MAX_CONTENT_CHARS + 1000) + "</p></body></html>"
    text = extract_text(long_html)
    assert len(text) <= MAX_CONTENT_CHARS


def test_summarize_with_bedrock_converse_response():
    """summarize_with_bedrock parses Converse API output correctly."""
    from api.generate_description import summarize_with_bedrock

    mock_response = {
        "output": {
            "message": {
                "content": [{"text": "A great website for developers and builders."}]
            }
        }
    }

    with patch("boto3.client") as mock_client_factory:
        mock_client = MagicMock()
        mock_client.converse.return_value = mock_response
        mock_client_factory.return_value = mock_client

        summary, err = summarize_with_bedrock("x" * 100, "https://example.com")
    assert err is None
    assert summary == "A great website for developers and builders."
    mock_client.converse.assert_called_once()


# ---------------------------------------------------------------------------
# AI autofill: GitHub README, page metadata, logo choice, safe_fetch, model parsing
# ---------------------------------------------------------------------------
import io
import socket
import time

import api.generate_description as gd


def _png(size):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", size, "red").save(buf, "PNG")
    return buf.getvalue()


def _fake_fetch(routes, requested):
    """safe_fetch stand-in: routes maps url -> (bytes, content_type); anything else is a 404."""
    def fetch(url, max_bytes, timeout, user_agent=None):
        requested.append(url)
        if url not in routes:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        data, ctype = routes[url]
        return data, ctype, url
    return fetch


import urllib.error  # noqa: E402


def _addr(ip):
    return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))]


CATS = [{"id": "CATEGORY#1", "name": "Developer Tools"}, {"id": "CATEGORY#2", "name": "News"}]
GOOD_JSON = '{"title": "Cool Tool", "description": "Does cool things.", "categories": ["developer tools"], "newCategories": ["Testing"]}'


def test_github_repo_fetches_readme_not_github_about():
    requested = []
    routes = {
        "https://raw.githubusercontent.com/octo/widget/HEAD/README.md": (b"# Widget\nA library that renders widgets quickly and safely.", "text/plain"),
        "https://github.com/octo.png": (_png((120, 120)), "image/png"),
    }
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, requested)), \
            patch.object(gd, "summarize_with_bedrock", return_value=(GOOD_JSON, None)) as model:
        result = gd.generate_description("https://github.com/octo/widget", CATS)
    assert requested[0] == "https://raw.githubusercontent.com/octo/widget/HEAD/README.md"
    assert not any(u.startswith("https://github.com/about") or u == "https://github.com/octo/widget" for u in requested)
    assert "A library that renders widgets" in model.call_args.args[0]
    assert result["logoUrl"] == "https://github.com/octo.png"
    assert result["logoError"] is None


def test_github_readme_falls_back_through_names_then_generic():
    requested = []
    with patch.object(gd, "safe_fetch", _fake_fetch({}, requested)):
        info = gd.gather_content("github.com/octo/widget", time.monotonic() + 22)
    raws = [u for u in requested if u.startswith("https://raw.githubusercontent.com/")]
    assert [u.rsplit("/", 1)[1] for u in raws] == ["README.md", "readme.md", "README.rst", "README"]
    assert "https://github.com/octo/widget" in requested  # generic path with the full given URL
    assert info["text"] == ""


@pytest.mark.parametrize("url", [
    "https://github.com/o/r", "https://github.com/o/r/", "https://github.com/o/r.git",
    "https://github.com/o/r/tree/main/docs", "http://www.github.com/o/r?tab=readme",
])
def test_parse_github_repo_variants(url):
    assert gd.parse_github_repo(url) == ("o", "r")


@pytest.mark.parametrize("url", [
    "https://github.com/o", "https://github.com/o/", "https://gist.github.com/o/abc",
    "https://example.com/o/r", "https://notgithub.com/o/r",
])
def test_parse_github_repo_non_matches(url):
    assert gd.parse_github_repo(url) is None


SAMPLE_HTML = """<html><head><title>Plain Title</title>
<meta name="description" content="Meta blurb about the site">
<meta property="og:site_name" content="Site Name">
<meta property="og:image" content="/og.png">
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="apple-touch-icon" sizes="57x57" href="/a57.png">
<link rel="apple-touch-icon" sizes="180x180" href="/a180.png">
<link rel="icon" sizes="192x192" href="/i192.png">
</head><body><p>""" + "Real page body text for the summary. " * 5 + "</p></body></html>"


def test_generic_site_fetches_given_url_with_path_and_extracts_metadata():
    requested = []
    url = "https://example.com/products/widget"
    routes = {url: (SAMPLE_HTML.encode(), "text/html")}
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, requested)):
        info = gd.gather_content("example.com/products/widget", time.monotonic() + 22)
    assert requested == [url]  # path kept, no about-page fallback because the page text is long enough
    assert info["title"] == "Site Name"
    assert info["text"].startswith("Meta description: Meta blurb about the site")
    assert "Real page body text" in info["text"]
    assert info["logos"] == [
        "https://example.com/a180.png", "https://example.com/a57.png",
        "https://example.com/logo.svg", "https://example.com/i192.png", "https://example.com/og.png",
    ]


def test_thin_page_falls_back_to_about_pages():
    requested = []
    routes = {
        "https://example.com/x": (b"<html><body>hi</body></html>", "text/html"),
        "https://example.com/about": (b"<html><body>" + b"About us text goes here. " * 5 + b"</body></html>", "text/html"),
    }
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, requested)):
        info = gd.gather_content("https://example.com/x", time.monotonic() + 22)
    assert "https://example.com/about" in requested
    assert "About us text" in info["text"]


def test_no_logo_still_200_with_logo_error_and_title_fallback():
    requested = []
    html = b"<html><head><title>Only Title</title></head><body>" + b"Plenty of readable text here. " * 5 + b"</body></html>"
    routes = {"https://example.com/": (html, "text/html")}
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, requested)), \
            patch.object(gd, "summarize_with_bedrock", return_value=('{"description": "Short.", "title": ""}', None)):
        result = gd.generate_description("https://example.com/", CATS)
    assert result["logoUrl"] is None
    assert result["logoError"] == gd.LOGO_ERROR
    assert result["title"] == "Only Title"
    assert result["description"] == "Short."
    assert result["categoryIds"] == [] and result["suggestedCategories"] == []


def test_pick_logo_rejects_small_and_wrong_type_and_accepts_svg():
    requested = []
    routes = {
        "https://e.com/small.png": (_png((50, 50)), "image/png"),
        "https://e.com/page.html": (b"<html/>", "text/html"),
        "https://e.com/fake.svg": (b"<html>no</html>", "image/svg+xml"),
        "https://e.com/big.png": (_png((100, 100)), "image/png"),
    }
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, requested)):
        picked = gd.pick_logo(list(routes) , time.monotonic() + 22)
        svg = gd.pick_logo(["https://e.com/l.svg"], time.monotonic() + 22)
    assert picked == "https://e.com/big.png"
    assert svg is None  # 404 in this routes table
    routes["https://e.com/l.svg"] = (b'<svg xmlns="x"/>', "image/svg+xml")
    with patch.object(gd, "safe_fetch", _fake_fetch(routes, [])):
        assert gd.pick_logo(["https://e.com/l.svg"], time.monotonic() + 22) == "https://e.com/l.svg"


# --- safe_fetch ---

@pytest.mark.parametrize("ip", ["127.0.0.1", "169.254.169.254", "10.0.0.5", "::1", "::ffff:10.0.0.5", "fc00::1", "192.168.1.1", "172.16.0.1"])
def test_safe_fetch_refuses_non_public_addresses(ip):
    with patch("socket.getaddrinfo", return_value=_addr(ip)), \
            patch("urllib.request.OpenerDirector.open") as opened:
        with pytest.raises(ValueError):
            gd.safe_fetch("http://some.host/x", 1000, 5)
    opened.assert_not_called()


def test_safe_fetch_refuses_if_any_resolved_address_is_private():
    with patch("socket.getaddrinfo", return_value=_addr("8.8.8.8") + _addr("10.0.0.1")):
        with pytest.raises(ValueError):
            gd.safe_fetch("http://some.host/x", 1000, 5)


def test_safe_fetch_refuses_non_http_scheme():
    with patch("socket.getaddrinfo") as resolve:
        with pytest.raises(ValueError):
            gd.safe_fetch("file:///etc/passwd", 1000, 5)
    resolve.assert_not_called()


def test_safe_fetch_revalidates_redirect_target():
    handler = gd._GuardedRedirect()
    req = urllib.request.Request("https://public.example/")
    with patch("socket.getaddrinfo", return_value=_addr("169.254.169.254")):
        with pytest.raises(ValueError):
            handler.redirect_request(req, None, 302, "Found", {}, "http://metadata.internal/latest")
    with patch("socket.getaddrinfo", return_value=_addr("93.184.216.34")):
        assert handler.redirect_request(req, io.BytesIO(), 302, "Found", {}, "https://other.example/") is not None


def _resp(body, ctype="text/html"):
    r = MagicMock()
    r.read.side_effect = lambda n=-1: body[:n]
    r.headers = {"Content-Type": ctype + "; charset=utf-8"}
    r.geturl.return_value = "https://public.example/final"
    r.__enter__ = lambda self: self
    r.__exit__ = lambda self, *a: None
    return r


def test_safe_fetch_enforces_max_bytes_and_returns_metadata():
    with patch("socket.getaddrinfo", return_value=_addr("93.184.216.34")), \
            patch("urllib.request.OpenerDirector.open", return_value=_resp(b"x" * 11)):
        with pytest.raises(ValueError):
            gd.safe_fetch("https://public.example/", 10, 5)
    with patch("socket.getaddrinfo", return_value=_addr("93.184.216.34")), \
            patch("urllib.request.OpenerDirector.open", return_value=_resp(b"x" * 10)):
        data, ctype, final = gd.safe_fetch("public.example", 10, 5)
    assert (data, ctype, final) == (b"x" * 10, "text/html", "https://public.example/final")


# --- model output ---

def test_parse_model_output_clean_and_fenced_json():
    for raw in (GOOD_JSON, "```json\n" + GOOD_JSON + "\n```", "Sure! Here it is: " + GOOD_JSON):
        title, desc, ids, new = gd.parse_model_output(raw, CATS)
        assert (title, desc, ids, new) == ("Cool Tool", "Does cool things.", ["CATEGORY#1"], ["Testing"])


def test_parse_model_output_prose_becomes_description():
    assert gd.parse_model_output("Just a plain summary.", CATS) == ("", "Just a plain summary.", [], [])
    assert gd.parse_model_output("{broken json", CATS) == ("", "{broken json", [], [])


def test_parse_model_output_drops_hallucinated_and_duplicate_categories():
    raw = json.dumps({
        "title": "T" * 200, "description": "d",
        "categories": ["Nonexistent", "news", "NEWS"],
        "newCategories": ["developer tools", " Testing ", "testing", "", "Extra", "Third", "x" * 80],
    })
    title, desc, ids, new = gd.parse_model_output(raw, CATS)
    assert len(title) == 120
    assert ids == ["CATEGORY#2"]  # unknown dropped, duplicate collapsed, mapped case-insensitively
    assert new == ["Testing", "Extra"]  # existing name and dupes dropped, capped at 2


def test_parse_model_output_zero_existing_categories():
    assert gd.parse_model_output(GOOD_JSON, [])[2] == []


def test_summarize_prompt_has_category_names_only_and_untrusted_warning():
    mock_response = {"output": {"message": {"content": [{"text": "{}"}]}}}
    with patch("boto3.client") as factory:
        factory.return_value.converse.return_value = mock_response
        gd.summarize_with_bedrock("x" * 100, "https://e.com", ["Developer Tools"])
    kw = factory.return_value.converse.call_args.kwargs
    prompt = kw["messages"][0]["content"][0]["text"]
    assert "Developer Tools" in prompt and "CATEGORY#" not in prompt
    assert "untrusted" in prompt.lower()
    assert kw["inferenceConfig"]["maxTokens"] == 600


def test_generateDescription_handler_passes_existing_categories_and_returns_contract():
    from api.handler import handler
    listed = {"statusCode": 200, "body": json.dumps({"categories": [{"PK": "CATEGORY#1", "name": "Developer Tools"}]})}
    info = {"text": "x" * 100, "title": "Fallback", "logos": [], "url": "https://example.com/"}
    with patch("api.handler.listCategories", return_value=listed), \
            patch.object(gd, "gather_content", return_value=info), \
            patch.object(gd, "summarize_with_bedrock", return_value=(GOOD_JSON, None)):
        result = handler(_admin_event("/sites/generate-description", body={"url": "https://example.com"}), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"]) == {
        "title": "Cool Tool", "description": "Does cool things.", "aiGenerated": True,
        "logoUrl": None, "logoError": gd.LOGO_ERROR,
        "categoryIds": ["CATEGORY#1"], "suggestedCategories": ["Testing"],
    }
