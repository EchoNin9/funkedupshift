# Publishing Daily Digests to feed.e9.cx

## Endpoint & Auth
- **URL:** `POST https://gd6m8kct88.execute-api.us-east-1.amazonaws.com/feeds/ingest`
  - Host comes from Terraform output `apiInvokeUrl` (`terraform -chdir=infra output -raw apiInvokeUrl`) and is published in `https://feed.e9.cx/config.js` (`window.API_BASE_URL`).
- **Auth header:** `X-Api-Key: <contents of ~/.openclaw/feeds.token>`
  - **One shared API token works for all agents and all feeds.** API keys on `feed.e9.cx` are scoped to the user account, not individual feeds. Generate one key in `https://feed.e9.cx/settings`, store it in `~/.openclaw/feeds.token` (`chmod 600`), and share it across Mox, qwer, and Rally. (Up to 20 active keys per account are supported if separate per-agent revocation or "Last used" tracking is ever wanted; each key has its own 60 requests/min rate limit.)
  - Never print, log, or commit the token.
- **Content-Type:** `application/json`

## Rules: One Feed per Lane, One HTML Digest per Day
1. **Separate feed slug per update lane.** Every distinct digest/stream MUST use its own stable lowercase slug matching `^[a-z0-9][a-z0-9-]{0,63}$`. The first publish for any slug auto-creates that push feed with the given top-level `title` (max 120 chars; subsequent publishes do not overwrite a user-renamed title).
   Recommended slugs:
   - `mox-todoist` — title: `Mox · Todoist`
   - `mox-jinks-email` — title: `Mox · Jinks Email`
   - `mox-concerts` (or `mox-events`) — title: `Mox · Concerts & Events`
   - `mox-family-email` — title: `Mox · Family Email`
   - `qwer-daily-newsletter` — title: `qwer · Daily Newsletter`
   - `rally-squash-digest` — title: `Rally · Squash Digest`
   *(Create a new slug whenever a new recurring digest lane is added; do not mix unrelated digests in one slug.)*

2. **One HTML digest entry per day (idempotent & fixable).**
   - Always send a deterministic `guid` per lane per day (max 512 chars): `<slug>-<YYYY-MM-DD>` using the `America/Los_Angeles` local calendar date (e.g. `mox-todoist-2026-11-19`).
   - Re-posting with the same `guid` **overwrites that day's digest in place** without creating duplicates (safe for retries or fixing a broken run).
   - If a single lane runs multiple times a day and you want separate entries on the same day instead of overwriting, append a run suffix (e.g. `mox-concerts-2026-11-19-pm`).
   - Set `"date": "YYYY-MM-DD"` (top-level fallback calendar day) and/or item `"publishedAt"` (ISO-8601 UTC timestamp such as `2026-11-19T15:30:00Z`, or a bare `YYYY-MM-DD` date). When `"publishedAt"` is an ISO-8601 timestamp, it takes precedence over `"date"` and is bucketed into the user's configured archive timezone (default `America/Los_Angeles`); a bare `YYYY-MM-DD` (in `"publishedAt"`, or in `"date"` when `"publishedAt"` is omitted) pins directly to that calendar day.

3. **HTML formatting (`contentHtml`).**
   - The ingest endpoint accepts JSON containing the rendered HTML string in `"contentHtml"` rather than raw `.html` file uploads. Each day's post automatically appears as a readable entry under that feed's date picker on `https://feed.e9.cx`.
   - Send clean semantic HTML in `"contentHtml"` (takes precedence when provided). If you only have Slack text or Markdown, you may send `"contentMrkdwn"` or `"contentMarkdown"` instead and the server converts it to HTML automatically (`<url|label>`, `*bold*`, `•` lists, etc.).
   - Do **not** rely on `<style>`, `<script>`, `<img>`, or `<svg>` — the server sanitizes with `nh3` and strips styles, scripts, and images in v1.
   - Allowed structural tags: `<h1>`–`<h6>`, `<p>`, `<br>`, `<hr>`, `<ul>`, `<ol>`, `<li>`, `<a>` (`href` and `title` attributes only; `http`/`https`/`mailto` schemes only; `target="_blank" rel="noopener noreferrer"` is added automatically), `<strong>`, `<b>`, `<em>`, `<i>`, `<u>`, `<s>`, `<del>`, `<blockquote>`, `<code>`, `<pre>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`, `<span>`, `<div>`.
   - Limits: total HTTP JSON body **<= 256 KB**, single item HTML **<= 100,000 chars / 200,000 UTF-8 bytes**, item `title` required (**<= 300 chars**), max **100 items** per request.
   - If an agent (such as `qwer`) already writes a daily `.html` file to disk, extract the inner `<body>` semantic HTML (stripping `<head>`/`<style>` wrappers) and pass it as `"contentHtml"` in the JSON payload.

4. **Non-blocking delivery.**
   - Publish to `feed.e9.cx` **after** the primary Slack delivery succeeds.
   - If the HTTP publish fails or times out, log the error and exit cleanly — never fail the cron run or block Slack posting.

## JSON Payload Schema
```json
{
  "feed": "mox-concerts",
  "title": "Mox · Concerts & Events",
  "date": "2026-11-19",
  "items": [
    {
      "guid": "mox-concerts-2026-11-19",
      "title": "Concerts & Events — 2026-11-19",
      "publishedAt": "2026-11-19T15:30:00Z",
      "summary": "Optional short plain-text preview (auto-generated from HTML if omitted)",
      "contentHtml": "<h2>Upcoming Shows</h2><ul><li><a href=\"https://example.com/tickets\">Band Name — Venue (Dec 4)</a></li></ul>"
    }
  ]
}
```

## Example Publishing Command (Safe JSON Escaping via Python)
Use Python's standard library (or `jq`) to build the JSON payload from an HTML fragment (or extract inner `<body>` from a standalone `.html` file so `<title>` text does not leak) and catch all errors so failures remain non-fatal:

```bash
python3 - <<'PY'
import datetime
import json
import os
import re
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

API_URL = "https://gd6m8kct88.execute-api.us-east-1.amazonaws.com/feeds/ingest"

try:
    with open(os.path.expanduser("~/.openclaw/feeds.token"), "r", encoding="utf-8") as f:
        TOKEN = f.read().strip()

    slug = "mox-concerts"
    feed_title = "Mox · Concerts & Events"
    today_la = datetime.datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Read semantic HTML fragment (or extract inner <body> if file is a full HTML document):
    with open("/tmp/digest.html", "r", encoding="utf-8") as f:
        raw_html = f.read()
    body_match = re.search(r"<body\b[^>]*>(.*)</body>", raw_html, re.IGNORECASE | re.DOTALL)
    html_body = (body_match.group(1) if body_match else re.sub(r"<head\b[^>]*>.*?</head>", "", raw_html, flags=re.IGNORECASE | re.DOTALL)).strip()

    payload = {
        "feed": slug,
        "title": feed_title,
        "date": today_la,
        "items": [
            {
                "guid": f"{slug}-{today_la}",
                "title": f"{feed_title} — {today_la}",
                "publishedAt": now_utc,
                "contentHtml": html_body,
            }
        ],
    }

    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": TOKEN,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        print("feed.e9.cx ingest ok:", resp.status, resp.read().decode("utf-8"))
except urllib.error.HTTPError as exc:
    err_body = exc.read().decode("utf-8", errors="replace")
    print("feed.e9.cx ingest failed (non-fatal):", exc.code, err_body)
except Exception as exc:
    print("feed.e9.cx ingest failed (non-fatal):", exc)
PY
```

## Expected Success Response (`200 OK`)
```json
{
  "feedId": "<uuid>",
  "slug": "mox-concerts",
  "created": true,
  "itemsAdded": 1,
  "itemsUpdated": 0
}
```
- On subsequent publishes to the same slug, `"created"` is `false`; re-posting the same `guid` returns `"itemsAdded": 0, "itemsUpdated": 1`.
- Common errors: `400` (invalid slug/date/JSON, or missing/empty item `title`; overlong feed/item titles over 120/300 chars are silently truncated), `401` (missing, invalid, or revoked `X-Api-Key`), `413` (body exceeds 256 KB), `429` (rate limit exceeded — >60 req/min on this key).
