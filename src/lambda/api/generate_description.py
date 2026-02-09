"""
Generate AI description for a website. Fetches HTML, extracts text,
tries about pages first, summarizes via AWS Bedrock Claude Haiku.
"""
import json
import logging
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

MAX_CONTENT_CHARS = 6000
FETCH_TIMEOUT_SEC = 10
BEDROCK_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


class TextExtractor(HTMLParser):
    """Extract visible text from HTML, skipping script/style."""

    def __init__(self):
        super().__init__()
        self.text_parts = []
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("script", "style", "noscript"):
            self.skip = True

    def handle_endtag(self, tag):
        if tag.lower() in ("script", "style", "noscript"):
            self.skip = False

    def handle_data(self, data):
        if not self.skip and data:
            cleaned = data.strip()
            if cleaned:
                self.text_parts.append(cleaned)

    def get_text(self):
        return " ".join(self.text_parts)


def fetch_html(url):
    """Fetch HTML from URL. Returns (html_str, error_msg)."""
    if not url or not url.strip():
        return None, "URL is required"
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Funkedupshift/1.0; +https://github.com)"},
            method="GET",
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = True
        ctx.verify_mode = ssl.CERT_REQUIRED
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SEC, context=ctx) as resp:
            if resp.status != 200:
                return None, f"HTTP {resp.status}"
            try:
                raw = resp.read()
                return raw.decode("utf-8", errors="replace"), None
            except Exception as e:
                return None, str(e)
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return None, str(e.reason) if e.reason else str(e)
    except Exception as e:
        logger.exception("fetch_html error: %s", e)
        return None, str(e)


def extract_text(html):
    """Extract main text from HTML. Prefer main, article, body."""
    if not html or not html.strip():
        return ""
    parser = TextExtractor()
    try:
        parser.feed(html)
        text = parser.get_text()
    except Exception:
        text = ""
    if not text:
        text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", html, flags=re.IGNORECASE)
        text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
    return text[:MAX_CONTENT_CHARS]


def try_about_pages(base_url):
    """Try /about, /about-us, /about.html, / then base. Return (text, url_used)."""
    parsed = urllib.parse.urlparse(base_url.strip())
    if not parsed.scheme:
        base_url = "https://" + base_url
        parsed = urllib.parse.urlparse(base_url)
    netloc = parsed.netloc or parsed.path.split("/")[0]
    scheme = parsed.scheme or "https"
    base = f"{scheme}://{netloc}"
    base = base.rstrip("/")

    candidates = [
        f"{base}/about",
        f"{base}/about-us",
        f"{base}/about.html",
        f"{base}/about-us.html",
        base,
    ]

    best_text = ""
    best_url = base

    for candidate in candidates:
        html, err = fetch_html(candidate)
        if err:
            logger.info("fetch %s failed: %s", candidate, err)
            continue
        text = extract_text(html)
        if len(text) > len(best_text) and len(text) > 50:
            best_text = text
            best_url = candidate

    return best_text, best_url


def summarize_with_bedrock(text, url):
    """Call Bedrock Claude Haiku to summarize. Returns (summary, error_msg)."""
    if not text or len(text.strip()) < 30:
        return "", "Insufficient content to summarize"

    prompt = f"""Summarize this website content in 2-4 concise sentences suitable for a catalog description.
Website URL: {url}

Content:
{text[:MAX_CONTENT_CHARS]}

Write only the summary, no preamble."""

    try:
        import boto3

        region = __import__("os").environ.get("AWS_REGION", "us-east-1")
        client = boto3.client("bedrock-runtime", region_name=region)

        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 256,
            "temperature": 0.3,
            "messages": [
                {"role": "user", "content": [{"type": "text", "text": prompt}]}
            ],
        })

        response = client.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            contentType="application/json",
            body=body,
        )
        raw = response["body"].read()
        data = json.loads(raw)
        summary = data.get("content", [{}])[0].get("text", "").strip()
        if not summary:
            return "", "Empty response from model"
        return summary, None
    except Exception as e:
        logger.exception("summarize_with_bedrock error: %s", e)
        return "", str(e)


def generate_description(url):
    """
    Main entry: fetch site, extract text, summarize.
    Returns {"description": str, "aiGenerated": True} or {"error": str}.
    """
    if not url or not str(url).strip():
        return {"error": "URL is required"}

    text, used_url = try_about_pages(url)
    if not text:
        return {"error": "Could not fetch or extract content from URL"}

    summary, err = summarize_with_bedrock(text, used_url)
    if err:
        return {"error": err}

    return {"description": summary, "aiGenerated": True}


def generateDescription(event):
    """API handler: POST /sites/generate-description. Admin only."""
    from api.handler import getUserInfo
    from common.response import jsonResponse

    user = getUserInfo(event)
    if not user.get("userId"):
        return jsonResponse({"error": "Unauthorized"}, 401)
    if "admin" not in user.get("groups", []):
        return jsonResponse({"error": "Forbidden: admin role required"}, 403)

    try:
        body = json.loads(event.get("body", "{}"))
        url = (body.get("url") or "").strip()
        result = generate_description(url)
        if "error" in result:
            return jsonResponse(result, 400)
        return jsonResponse(result, 200)
    except json.JSONDecodeError:
        return jsonResponse({"error": "Invalid JSON body"}, 400)
    except Exception as e:
        logger.exception("generateDescription error: %s", e)
        return jsonResponse({"error": str(e)}, 500)
