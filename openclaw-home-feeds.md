# Publishing Daily Digests to feed.e9.cx

## Endpoint & Auth
- **URL:** `POST https://gd6m8kct88.execute-api.us-east-1.amazonaws.com/feeds/ingest`
  - Host comes from Terraform output `apiInvokeUrl` (`terraform -chdir=infra output -raw apiInvokeUrl`) and is published in `https://feed.e9.cx/config.js` (`window.API_BASE_URL`).
- **Auth header:** `X-Api-Key: <token from ~/.openclaw/e9_feed.token>`
  - **One shared API token works for all agents and all feeds.** API keys on `feed.e9.cx` are scoped to the user account, not individual feeds. Generate one key in `https://feed.e9.cx/settings`, store it in `~/.openclaw/e9_feed.token` (`chmod 600`), and share it across Mox, qwer, and Rally. That file is shell-style kv, not a bare token — `E9_FEED_API_URL=<ingest url>` and `E9_FEED_API_TOKEN=<key>` on separate lines — so the URL travels with the credential. (Up to 20 active keys per account are supported if separate per-agent revocation or "Last used" tracking is ever wanted; each key has its own 60 requests/min rate limit.)
  - Never print, log, or commit the token.
- **Content-Type:** `application/json`

## Rules: One Feed per Lane, One Entry per Line Item
1. **Separate feed slug per update lane.** Every distinct digest/stream MUST use its own stable lowercase slug matching `^[a-z0-9][a-z0-9-]{0,63}$`. The first publish for any slug auto-creates that push feed with the given top-level `title` (max 120 chars; subsequent publishes do not overwrite a user-renamed title).
   Recommended slugs:
   - `mox-todoist` — title: `Mox · Todoist`
   - `mox-jinks-email` — title: `Mox · Jinks Email`
   - `mox-concerts` (or `mox-events`) — title: `Mox · Concerts & Events`
   - `mox-family-email` — title: `Mox · Family Email`
   - `qwer-daily-newsletter` — title: `qwer · Daily Newsletter`
   - `rally-squash-digest` — title: `Rally · Squash Digest`
   *(Create a new slug whenever a new recurring digest lane is added; do not mix unrelated digests in one slug.)*

2. **One entry per line item, not one entry per day.**
   - Split the digest so that **each bullet / line item is its own feed item** in the `items` array. The reader renders its per-item **Seen** checkbox and star on each feed *item*, so a whole-day blob gives the reader exactly one checkbox for the entire digest — the thing readers actually want to tick off is the individual line. Up to **100 items** per request.
   - Publishers do this with `--split-items` on `~/.openclaw/scripts/feed_publish.py`, which breaks the top-level `<li>`s of a rendered digest into one item each. A nested sub-list stays attached to its parent bullet; when the digest has no list at all it falls back to a single entry.
   - Give each item a **content-derived** `guid` (max 512 chars): `<slug>-<YYYY-MM-DD>-<sha1(item text)[:10]>`, using the `America/Los_Angeles` local calendar date (e.g. `mox-todoist-2026-11-19-6a6d3c1ad7`). Content hashing (rather than a positional index) is what keeps Seen/starred state pinned to the right line when a later re-publish of the same day inserts or reorders bullets.
   - Re-posting with the same `guid` **overwrites that item in place** without creating duplicates (safe for retries or fixing a broken run).
   - Per-item `link` should be the bullet's primary `http(s)` URL when it has one, so the entry title is clickable.
   - If a single lane runs multiple times a day and you want the second run kept separately, append a run suffix to the day portion (e.g. `mox-concerts-2026-11-19-pm-<hash>`).
   - **There is no per-item delete in the API** — only `DELETE /feeds/{id}` for an entire feed. A day published as one blob keeps that blob; re-publishing it split adds the per-line items alongside it rather than replacing it.
   - Set `"date": "YYYY-MM-DD"` (top-level fallback calendar day; applies to every item in the request) and/or item `"publishedAt"` (ISO-8601 UTC timestamp such as `2026-11-19T15:30:00Z`, or a bare `YYYY-MM-DD` date). When `"publishedAt"` is an ISO-8601 timestamp, it takes precedence over `"date"` and is bucketed into the user's configured archive timezone (default `America/Los_Angeles`); a bare `YYYY-MM-DD` (in `"publishedAt"`, or in `"date"` when `"publishedAt"` is omitted) pins directly to that calendar day.

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
      "guid": "mox-concerts-2026-11-19-6a6d3c1ad7",
      "title": "Band Name",
      "link": "https://example.com/tickets",
      "publishedAt": "2026-11-19T15:30:00Z",
      "summary": "Optional short plain-text preview (auto-generated from HTML if omitted)",
      "contentHtml": "<a href=\"https://example.com/tickets\">Band Name</a> — Dec 4 · Venue, Vancouver"
    },
    {
      "guid": "mox-concerts-2026-11-19-b09a5abfe3",
      "title": "Other Band",
      "link": "https://example.com/other",
      "publishedAt": "2026-11-19T15:30:00Z",
      "contentHtml": "<a href=\"https://example.com/other\">Other Band</a> — Dec 11 · Commodore Ballroom, Vancouver"
    }
  ]
}
```

## Publishing in Practice
OpenClaw agents do not hand-roll this call — the shared helper does it:

```bash
python3 ~/.openclaw/scripts/feed_publish.py --split-items \
  --slug mox-concerts --title 'Mox · Concerts & Events' \
  --html-file /tmp/feed_mox-concerts.html
```

It reads `~/.openclaw/e9_feed.token`, extracts the inner `<body>` from a full HTML document, splits top-level `<li>`s into one item each with content-hashed guids, and **always exits 0** so a failed publish can never break the cron's Slack delivery. Add `--dry-run` to print the payload without POSTing.

## Example Payload Construction (Safe JSON Escaping via Python)
If you must build the request directly, use Python's standard library (or `jq`) to build the JSON payload from an HTML fragment (or extract inner `<body>` from a standalone `.html` file so `<title>` text does not leak), split it per line item, and catch all errors so failures remain non-fatal:

```bash
python3 - <<'PY'
import datetime
import hashlib
import html
import json
import os
import re
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

API_URL = "https://gd6m8kct88.execute-api.us-east-1.amazonaws.com/feeds/ingest"

try:
    # ~/.openclaw/e9_feed.token is shell-style kv: E9_FEED_API_URL= / E9_FEED_API_TOKEN=
    cfg = {}
    with open(os.path.expanduser("~/.openclaw/e9_feed.token"), "r", encoding="utf-8") as f:
        for line in f:
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip().strip("\"'")
    TOKEN = cfg["E9_FEED_API_TOKEN"]
    API_URL = cfg.get("E9_FEED_API_URL", API_URL)

    slug = "mox-concerts"
    feed_title = "Mox · Concerts & Events"
    today_la = datetime.datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d")
    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Read semantic HTML fragment (or extract inner <body> if file is a full HTML document):
    with open("/tmp/digest.html", "r", encoding="utf-8") as f:
        raw_html = f.read()
    body_match = re.search(r"<body\b[^>]*>(.*)</body>", raw_html, re.IGNORECASE | re.DOTALL)
    html_body = (body_match.group(1) if body_match else re.sub(r"<head\b[^>]*>.*?</head>", "", raw_html, flags=re.IGNORECASE | re.DOTALL)).strip()

    # One item per top-level <li> so each line item gets its own Seen checkbox.
    bullets = re.findall(r"<li\b[^>]*>(.*?)</li>", html_body, re.IGNORECASE | re.DOTALL)
    items = []
    for bullet in bullets or [html_body]:
        text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", bullet))).strip()
        if not text:
            continue
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        items.append(
            {
                "guid": f"{slug}-{today_la}-{digest}",
                "title": text[:140],
                "publishedAt": now_utc,
                "contentHtml": bullet.strip(),
            }
        )

    payload = {
        "feed": slug,
        "title": feed_title,
        "date": today_la,
        "items": items,
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
  "itemsAdded": 3,
  "itemsUpdated": 0
}
```
- `"itemsAdded"` equals the number of line items sent, so a three-bullet digest reports `3`.
- On subsequent publishes to the same slug, `"created"` is `false`; re-posting unchanged bullets moves them into `"itemsUpdated"`, so a same-day re-run of an unchanged digest returns `"itemsAdded": 0, "itemsUpdated": 3`. A re-run where one bullet changed reports `"itemsAdded": 1` alongside the updated remainder, because the changed bullet hashes to a new `guid`.
- Common errors: `400` (invalid slug/date/JSON, or missing/empty item `title`; overlong feed/item titles over 120/300 chars are silently truncated), `401` (missing, invalid, or revoked `X-Api-Key`), `413` (body exceeds 256 KB), `429` (rate limit exceeded — >60 req/min on this key).
