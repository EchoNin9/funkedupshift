# Instagram Graph API — Content Publishing (implementation reference)

Audience: a Python 3.13 AWS Lambda that calls the Instagram Graph API using only
stdlib `urllib` (no `requests`, no Facebook Business SDK). Every request/response
shape below is written so it can be typed directly into `urllib.request.Request`
calls and parsed with `json.loads`.

**Documented against:** Graph API **v25.0** (the version Meta's own
`content-publishing` docs currently show in their curl examples, as of this
writing — 2026-08-03). Meta ships a new major version roughly every 4–5 months;
per the version changelog, **v26.0** was released 2026-07-29 (days before this
doc was written) and **v21.0** is the oldest version still inside its support
window (expires 2027-01-21). **Pin an explicit version segment in every URL**
(e.g. `/v25.0/...`, never `/v21.0` and never version-less) and revisit this doc
when you bump it — Meta silently changes defaults/behavior between versions
more often than the changelog implies.

Primary sources used throughout (cited again per-section):
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- https://developers.facebook.com/docs/graph-api/guides/error-handling
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/
- https://developers.facebook.com/docs/graph-api/changelog/versions/

---

## 1. Base URL and versioning

There are **two distinct auth/host models** for Instagram publishing. Getting
this wrong is the single most common integration mistake, so it's called out
up front (see §9 for the full token discussion):

| Model | Host | Applies to |
|---|---|---|
| **Instagram API with Facebook Login** | `graph.facebook.com` | Business/Creator IG accounts linked to a Facebook Page, accessed via a Facebook Login flow and a **Page access token**. This is the model for "Business accounts" in the traditional sense (Page + linked IG account). |
| **Instagram API with Instagram Login** | `graph.instagram.com` | IG accounts (Business or Creator) that log in directly to your app via Instagram Login (no Facebook Page/Login involved). Newer model, launched July 2024. |
| Resumable video upload (both models) | `rupload.facebook.com` | `POST https://rupload.facebook.com/ig-api-upload/<IG_MEDIA_CONTAINER_ID>` — only needed for large/chunked video uploads; the simple `video_url` flow below does not use this host. |

**For this project (a standard Facebook-Login-based Business IG account), the
correct host is `graph.facebook.com`, version-prefixed:**

```
https://graph.facebook.com/v25.0/<IG_USER_ID>/media
https://graph.facebook.com/v25.0/<IG_USER_ID>/media_publish
https://graph.facebook.com/v25.0/<IG_CONTAINER_ID>?fields=status_code
https://graph.facebook.com/v25.0/<IG_USER_ID>/content_publishing_limit
```

`graph.instagram.com` is the correct host only if you migrate to Instagram
Login (direct IG auth, no linked FB Page in the loop) — noted here because a lot
of blog examples mix the two hosts interchangeably; they are not
interchangeable for token purposes (§9).

`<IG_USER_ID>` is the Instagram-scoped user ID (the professional account's IG
User ID, obtained via `GET /<PAGE_ID>?fields=instagram_business_account` in the
Facebook-Login model), not the numeric Instagram username-facing ID and not the
linked Facebook Page ID.

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/

---

## 2. Single image post

### Step 1 — create the media container

```
POST https://graph.facebook.com/v25.0/<IG_USER_ID>/media
Content-Type: application/x-www-form-urlencoded (or JSON body; Meta accepts both — see note)
```

Parameters (from the `POST /{ig-user-id}/media` reference):

| Param | Required | Notes |
|---|---|---|
| `image_url` | required for images | Public HTTPS URL Meta will fetch server-side. |
| `caption` | optional | Max 2200 chars, max 30 hashtags, max 20 `@` mentions. |
| `location_id` | optional | A Facebook Page ID representing a location, to tag. |
| `user_tags` | optional | Array of `{"username": "...", "x": 0.0-1.0, "y": 0.0-1.0}`. `x`/`y` are optional for tagging (required only in some contexts); JSON-encode the array and URL-encode it if sent as a query string. |
| `alt_text` | optional, **image posts only** | Up to 1000 characters. Added to the API 2025-03-24 — don't rely on it existing in versions predating that rollout. |
| `is_carousel_item` | only for carousel children | `true`/`false` — see §4. |
| `is_ai_generated` | optional | Self-disclosure of AI-generated content. |
| `access_token` | required | Page-derived IG token (see §9). |

Example request (form-encoded, easiest with stdlib `urllib`):

```python
import urllib.request, urllib.parse

params = {
    "image_url": "https://example-bucket.s3.amazonaws.com/photo.jpg",
    "caption": "Hello from the Lambda #test",
    "alt_text": "A red bicycle leaning against a brick wall",
    "access_token": ACCESS_TOKEN,
}
data = urllib.parse.urlencode(params).encode()
req = urllib.request.Request(
    f"https://graph.facebook.com/v25.0/{IG_USER_ID}/media",
    data=data, method="POST",
)
```

Response:

```json
{ "id": "<IG_CONTAINER_ID>" }
```

Image containers are effectively synchronous (no meaningful processing delay),
but nothing in Meta's docs guarantees this — see §3 for the general
status-polling contract, which is safe to apply uniformly to every media type.

### Step 2 — publish

```
POST https://graph.facebook.com/v25.0/<IG_USER_ID>/media_publish
```

| Param | Required |
|---|---|
| `creation_id` | required — the container `id` from step 1 |
| `access_token` | required |

Response:

```json
{ "id": "<IG_MEDIA_ID>" }
```

This `id` is the final published Instagram Media ID. (Meta's docs confirm it is
"the Instagram Media ID" but do not explicitly spell out permalink
construction from it — flagged under §12.)

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/

---

## 3. Video / Reels

Reels are the primary supported single-video post type; plain feed `VIDEO`
posts use the same shape with `media_type=VIDEO` instead of `REELS`.

### Create container

```
POST https://graph.facebook.com/v25.0/<IG_USER_ID>/media
```

```json
{
  "media_type": "REELS",
  "video_url": "https://example-bucket.s3.amazonaws.com/clip.mp4",
  "caption": "New reel",
  "cover_url": "https://example-bucket.s3.amazonaws.com/cover.jpg",
  "thumb_offset": "3000",
  "share_to_feed": true,
  "audio_name": "Original audio - myhandle",
  "collaborators": ["collab_username"]
}
```

| Param | Notes |
|---|---|
| `media_type` | `"REELS"` (required for Reels). |
| `video_url` | required — public HTTPS URL. |
| `caption` | optional, same limits as images. |
| `cover_url` | optional — image used as the Reels-tab thumbnail. |
| `thumb_offset` | optional — milliseconds into the video to grab a frame for the cover if `cover_url` isn't given. |
| `share_to_feed` | optional bool — `true` posts to both Feed and Reels tabs, `false` Reels tab only. |
| `audio_name` | optional — display name for the audio track. |
| `collaborators` | optional — up to 3 IG usernames as collaborators (Feed image, Reels, and Carousels only). |
| `location_id`, `user_tags` | same semantics as image posts. |
| `alt_text` | **not** supported for Reels/video (image posts only). |
| `trial_params` | optional — `{"graduation_strategy": "MANUAL" | "SS_PERFORMANCE"}` for Trial Reels (limited-audience test reels). |

Response (identical shape to image containers):

```json
{ "id": "<IG_CONTAINER_ID>" }
```

### Asynchronous processing — status polling

Video containers process asynchronously server-side. Poll:

```
GET https://graph.facebook.com/v25.0/<IG_CONTAINER_ID>?fields=status_code,status
```

**Meta's explicit guidance: "query a container's status once per minute, for
no more than 5 minutes."** Only call `media_publish` once `status_code` is
`FINISHED`. (Source:
https://developers.facebook.com/docs/instagram-platform/content-publishing/)

#### `status_code` — complete enumeration

| Value | Meaning |
|---|---|
| `EXPIRED` | Container was not published within 24 hours of creation and has expired — must recreate the container. |
| `ERROR` | Container failed to complete the publishing process. |
| `FINISHED` | Container and its media object are ready to be published — safe to call `media_publish`. |
| `IN_PROGRESS` | Still processing — keep polling. |
| `PUBLISHED` | The container's media object has already been published. |

**Container validity window: 24 hours** from creation before it flips to
`EXPIRED`.

**On `ERROR`:** Meta's public docs list the five `status_code` values above but
do **not** document what the accompanying `status` field contains in the error
case (no enumerated sub-reasons, no error-message schema). Treat `status` as an
opaque human-readable string for logging only — don't pattern-match on it for
control flow. Flagged in §12.

Example poll response while processing:
```json
{ "status_code": "IN_PROGRESS", "status": "..." }
```

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/

### Video/Reels media requirements

From the `ig-user/media` reference page's specification tables:

| Property | Reels | Feed Video | Story Video |
|---|---|---|---|
| Container | MOV or MP4 (MPEG-4 Part 14); no edit lists; `moov` atom at front of file | same | same |
| Video codec | HEVC or H.264, progressive scan, closed GOP, 4:2:0 chroma subsampling | same | same |
| Audio codec | AAC, ≤48kHz sample rate, 1–2 channels (mono/stereo) | same | same |
| Frame rate | 23–60 FPS | same | same |
| Aspect ratio | 0.01:1 to 10:1 (9:16 recommended to avoid cropping) | 4:5 to 1.91:1 | 0.1:1 to 10:1 (9:16 recommended) |
| Max resolution (long edge) | 1920px | 1920px | 1920px |
| Video bitrate | ≤25 Mbps | ≤25 Mbps | ≤25 Mbps |
| Duration | 3 sec min, 15 min max (**only 5–90 sec clips at 9:16 are Reels-tab eligible** — longer/other-ratio clips publish but may not surface in the Reels tab) | — | 3 sec min, 60 sec max |
| Max file size | 300 MB | 300 MB | 100 MB |

Note: some third-party blog aggregations report an "8 MB" video file-size limit
— that number is Meta's **image** file-size cap (§7) misattributed to video in
secondary sources; it does not appear on the primary reference page for video.
Treat 300 MB (Reels/Feed video) / 100 MB (Story video) as authoritative from
the primary doc.

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/

---

## 4. Carousels

### Child containers

Each child is created exactly like a single image or video container, plus
`is_carousel_item=true`:

```json
{ "image_url": "https://.../item1.jpg", "is_carousel_item": true }
```
```json
{ "video_url": "https://.../item2.mp4", "is_carousel_item": true }
```

- **Max children: 10** ("Carousels are limited to 10 images, videos, or a mix").
- **Children can mix images and video** — confirmed explicitly ("a mix").
- `location_id` and `caption` are set on the **parent**, not children.

### Parent container

```json
{
  "media_type": "CAROUSEL",
  "children": "<CHILD_ID_1>,<CHILD_ID_2>,<CHILD_ID_3>",
  "caption": "Fruit candies"
}
```

`children` is a comma-separated string of child container IDs (despite the
reference table typing it as "array" — the curl examples pass it as a single
comma-joined string param, which is what you send over `urllib`-style
form-encoding).

### Do children need their own status polling?

**Unconfirmed** — Meta's docs show child creation and immediate parent
creation back-to-back in the example, with no explicit instruction to poll
each child's `status_code` before assembling the parent. Given that video
children process asynchronously exactly like standalone video containers,
the safe implementation is: **if any child is a video, poll that child's
`status_code` until `FINISHED` before including it in `children`** — but this
caution is an inference from the general video-processing model, not a
directly documented requirement for carousels specifically. Flagged in §12.

### Publish

Same as single media: `POST /<IG_USER_ID>/media_publish` with
`creation_id=<PARENT_CONTAINER_ID>`.

### Rate-limit accounting

Confirmed explicitly: **"Carousels count as a single post"** against the
publishing quota (§6), regardless of child count.

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/

---

## 5. Stories

`media_type=STORIES` is documented as part of the same `POST /media` endpoint
and appears in the general permissions/access table as available under
**Standard Access** (same access tier as feed/Reels/carousel publishing) —
Meta's docs don't call out Stories as Advanced-Access-only or gate it behind a
separate permission.

**Flag: availability details are thin.** The content-publishing guide gives no
concrete request example for Stories (just "create a container ... with
`media_type` set to `STORIES`"), and does not state:
- whether Story video containers require the same `FINISHED` status poll before
  `media_publish` (almost certainly yes, by analogy to Reels — Story video
  specs exist in the media-requirements table, implying the same async
  pipeline — but this is inference, not a documented statement),
- any Story-specific parameter restrictions beyond what's implied by the
  general parameter table (e.g., `user_tags` `x`/`y` coordinates are called
  out as "optional for stories" in the parameter reference, implying stickers
  work differently there).

Treat Stories support in this doc as **directionally correct but not
verified against a concrete worked example** — flagged in §12.

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/

---

## 6. Rate limits

```
GET https://graph.facebook.com/v25.0/<IG_USER_ID>/content_publishing_limit?fields=config,quota_usage&access_token=<TOKEN>
```

Optional `since` param: a Unix timestamp no older than 24 hours, to scope
`quota_usage` to a custom window.

Response:

```json
{
  "data": [
    {
      "quota_usage": 2,
      "config": {
        "quota_total": 50,
        "quota_duration": 86400
      }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `config.quota_total` | Max IG containers the app user can publish per `quota_duration` window. |
| `config.quota_duration` | Window length in seconds — `86400` = 24 hours. |
| `quota_usage` | Number of containers published since `since` (or since the start of the current rolling window if omitted). |

**Rolling window, not a calendar day.** Meta's content-publishing page states
the default plainly as: **"Instagram accounts are limited to 100 API-published
posts within a 24-hour moving period."** — note this figure (100) conflicts
with the `content_publishing_limit` reference page's own example response body
above, which shows `quota_total: 50`. Both numbers come from primary Meta
pages; **treat 100/24h as the currently-stated default quota and the `50` in
the reference example as a stale/illustrative example value, but verify against
a live `content_publishing_limit` call for the account in question before
hard-coding either number** — flagged in §12.

**Carousels count as a single post** against this quota regardless of child
count (confirmed, §4).

Sources:
- https://developers.facebook.com/docs/instagram-platform/content-publishing/
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit

---

## 7. Media requirements (validation rules)

### Images

| Property | Value |
|---|---|
| Format | **JPEG only.** Extended JPEG variants (MPO, JPS) are explicitly unsupported. |
| Max file size | 8 MB |
| Aspect ratio | 4:5 to 1.91:1 |
| Min width | 320 px |
| Max width | 1440 px |

Also noted as unsupported on image posts: Shopping tags, filters.

### Video (Reels / Feed video / Story video)

See the table in §3.

Source: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/

---

## 8. The media URL contract

Meta's servers fetch the media from the URL you supply (`image_url` /
`video_url`) — your Lambda never uploads bytes directly (except in the
resumable `rupload.facebook.com` path, not covered here since it's not needed
for URL-based publishing).

**Confirmed by Meta's docs:**
- The media "must be hosted on a publicly accessible server" at the time Meta
  attempts to fetch it — i.e., no authentication, no IP allowlist, no signed
  cookies Meta doesn't have.
- The container remains open for **24 hours** before expiring (§3), which
  implies (but does not explicitly state) that the source URL should stay
  reachable at least until you've observed `FINISHED`/`PUBLISHED`, since retries
  during processing are plausible.

**Not documented by Meta (community-reported, not verified against primary
docs — treat as unconfirmed):**
- Whether HTTP redirects (3xx) from the media URL are followed.
- Whether a specific `Content-Type` response header is required/enforced (vs.
  Meta sniffing the file extension or bytes).
- Fetch timeout duration.
- Whether presigned S3 URLs are supported — widely reported to work in
  practice by third-party integrators, but this is not a documented Meta
  guarantee, and presigned URL **expiry** must be set generously past your
  worst-case processing time (see the 24-hour container window) since Meta may
  re-fetch during processing.
- Whether the URL must remain valid *only* at initial fetch time, or through
  the entire `IN_PROGRESS` → `FINISHED` window.

**Practical recommendation for the Lambda implementation** (engineering
judgment, not a Meta doc citation): serve media from a stable, unauthenticated
or long-lived-presigned HTTPS URL (e.g., a public S3 object or a presigned URL
valid for several hours), and don't revoke/delete the underlying object until
you've observed `PUBLISHED` or the container's 24-hour window has elapsed.

Flagged in full under §12.

---

## 9. Token model

### Two distinct auth models — pick the one that matches the account

| | Instagram API with **Facebook Login** | Instagram API with **Instagram Login** |
|---|---|---|
| Host | `graph.facebook.com` | `graph.instagram.com` |
| Applies to | Business/Creator IG accounts **linked to a Facebook Page** | IG accounts logging in directly (no FB Page in the loop) |
| Token used for publishing | **Page access token** (for the linked Page), used against the IG User ID | **Instagram User access token** |
| Permissions/scopes | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (`pages_show_list` typically needed earlier in the OAuth flow to enumerate Pages; `business_management` needed if managing via a Business Manager asset), conditionally `ads_management`/`ads_read` | `instagram_business_basic`, `instagram_business_content_publish` |
| Token refresh endpoint | `GET /oauth/access_token?grant_type=fb_exchange_token&...` (Facebook Login long-lived exchange) | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...` |

**For a Business IG account linked to a Facebook Page (this project's likely
setup): use the Facebook Login model.** The `ig_refresh_token` /
`graph.instagram.com/refresh_access_token` endpoint is specific to the
Instagram-Login model and is **not** the mechanism for Page-derived tokens —
its own reference page ties it to the `instagram_business_basic` permission
and an "Instagram User (long-lived)" token type, which is the Instagram-Login
token class, not a Page token. Do not mix the two refresh mechanisms.

### Facebook Login flow — long-lived token exchange

```
GET https://graph.facebook.com/v25.0/oauth/access_token
    ?grant_type=fb_exchange_token
    &client_id=<APP_ID>
    &client_secret=<APP_SECRET>
    &fb_exchange_token=<SHORT_LIVED_USER_TOKEN>
```

Response:
```json
{
  "access_token": "<LONG_LIVED_USER_ACCESS_TOKEN>",
  "token_type": "bearer",
  "expires_in": 5183944
}
```
(`5183944` seconds ≈ 60 days — "a long-lived token generally lasts about 60
days.")

**Page access tokens derived from a long-lived User token are effectively
non-expiring**: Meta's own wording is *"Long-lived Page access tokens do not
have an expiration date and only expire or are invalidated under certain
conditions"* (password change, user revokes the app, token unused for an
extended period, etc.). Practically: exchange once for a long-lived user
token, then call `GET /<PAGE_ID>?fields=access_token` (or
`/me/accounts`) with that long-lived user token to mint the Page token you
actually use for publishing — that Page token does not need the 60-day
refresh cycle the user token does, though you should still monitor for
invalidation (§10).

### Instagram Login flow — refresh endpoint (for completeness, not this
project's path unless it migrates off Facebook Login)

```
GET https://graph.instagram.com/refresh_access_token
    ?grant_type=ig_refresh_token
    &access_token=<LONG_LIVED_IG_USER_TOKEN>
```

Response: same `{access_token, token_type, expires_in}` shape, valid 60 days
from refresh. Eligibility: token must be **at least 24 hours old** and **not
yet expired** — tokens that go 60 days unrefreshed expire outright and cannot
be refreshed after the fact (must redo the full OAuth flow).

Sources:
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/
- https://developers.facebook.com/docs/instagram-platform/content-publishing/ (permissions table)

---

## 10. Error handling

### Standard envelope

```json
{
  "error": {
    "message": "Message describing the error",
    "type": "OAuthException",
    "code": 190,
    "error_subcode": 460,
    "fbtrace_id": "EJplcsCHuLu"
  }
}
```

Always log `fbtrace_id` — it's what you'd hand to Meta support / include in
your own alerting for correlating a specific failed call.

### Error codes an implementer will actually hit

| Code | Subcode | Type | Meaning | Action |
|---|---|---|---|---|
| 4 | — | OAuthException | App-level rate limit reached | Back off; stop calling until the window resets. |
| 17 | — | OAuthException | User-level rate limit reached | Back off. |
| 32 | — | OAuthException | Page-level rate limit reached ("Page request limit reached") | Back off. |
| 613 | — | OAuthException | Custom/business-use-case rate limit reached | Back off; check `X-Business-Use-Case-Usage` header for `estimated_time_to_regain_access`. |
| 190 | — | OAuthException | Access token expired/invalid/revoked generically | Re-auth / refresh token. |
| 190 | 458 | OAuthException | App not installed for user | Re-authenticate user (full OAuth re-consent). |
| 190 | 459 | OAuthException | User checkpointed | User must resolve at facebook.com before token works again. |
| 190 | 460 | OAuthException | Password/session changed | Re-login required. |
| 190 | 463 | OAuthException | Token expired | Refresh/re-issue token. |
| 190 | 467 | OAuthException | Invalid access token | Re-issue token — token is malformed or was never valid for this call. |
| 10 | — | OAuthException / permission | Permission not granted or was removed | Check granted scopes; re-request consent. |
| 200–299 | varies | permission errors | Missing a specific permission for the call being made | Inspect `message` for which permission; re-request. |

**Publishing-specific sub-codes:** Meta's error-handling doc does not enumerate
a distinct table of `error_subcode` values specific to *content publishing*
(e.g., "invalid media format", "media download failed") — those failures
surface as a generic `ERROR` `status_code` on the container (§3) with an
undocumented free-text `status` string, not as a separate Graph API error
response with its own subcode. Don't build subcode-based branching for
media-specific failures; log the container's `status` string and treat any
non-`FINISHED` terminal state as a hard failure requiring re-creation.

Sources:
- https://developers.facebook.com/docs/graph-api/guides/error-handling
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting

---

## 11. Standard vs Advanced Access

**Confirmed:** Standard Access is the default access level and is sufficient
to publish to any Instagram professional account whose owning Facebook user
has a **role on your app** (Admin, Developer, or Tester in the App Dashboard)
— no App Review required for that case. Advanced Access (requiring App
Review + Business Verification) is only needed to publish on behalf of
real end users who do **not** have a role on your app — i.e., a live,
public-facing integration serving third parties.

For a single-tenant internal tool (an internal Lambda publishing to your own
brand's IG account, where the IG/FB account owner is added as an
Admin/Developer on the Meta App), **Standard Access is sufficient** — you
never need to submit for App Review.

Permissions involved (Facebook Login model): `instagram_basic`,
`instagram_content_publish`, plus `pages_show_list` and
`pages_read_engagement` during the OAuth/Page-enumeration step, and
`business_management` if the Page lives inside a Business Manager asset.
All of these are Standard-Access-eligible for role-having accounts.

Source: https://developers.facebook.com/docs/instagram-platform/content-publishing/
(permissions/access-level table), corroborated by Meta's general
Standard-vs-Advanced-Access framing in
https://developers.facebook.com/docs/graph-api/overview/access-levels (general
Meta platform docs on access levels, not Instagram-specific).

---

## 12. Unconfirmed / needs verification

Collected from the flags raised above — verify each against a live account /
Meta support before hard-coding behavior:

- **Publishing quota default value conflict**: the content-publishing guide's
  prose states **100** posts/24h; the `content_publishing_limit` reference
  page's own example JSON shows `quota_total: 50`. Query
  `content_publishing_limit` live for the target account rather than assuming
  either number (§6).
- **What the `status` field contains when `status_code == ERROR`** — no
  enumerated sub-reasons or schema documented anywhere in Meta's public docs
  found during this research (§3, §10).
- **Whether carousel children require individual `status_code == FINISHED`
  polling before being referenced in the parent's `children` param** — not
  explicitly stated; inferred by analogy to standalone video processing (§4).
- **Stories**: no concrete worked request/response example in Meta's current
  docs; unclear whether Story video containers follow the identical
  async-polling contract as Reels (very likely, but not directly stated) (§5).
- **Media URL contract specifics**: redirect-following behavior, required
  `Content-Type` header, fetch timeout, and presigned-S3-URL support are not
  documented by Meta — all are community-reported/inferred, not primary-source
  confirmed (§8).
- **Whether `media_publish`'s returned `id` can be mechanically turned into a
  permalink URL** — Meta confirms it's "the Instagram Media ID" but doesn't
  spell out permalink construction; use the separate `GET /<IG_MEDIA_ID>?fields=permalink`
  call instead of assuming a URL format (not independently verified in this
  research pass either — treat as a follow-up, not implemented behavior here).
- **`error_subcode` values specific to content-publishing failures** (e.g. a
  dedicated "invalid media" or "unsupported format" subcode) — none found
  in Meta's general error-handling reference; publishing failures appear to
  surface purely through the container `status_code`/`status` mechanism
  instead of distinct Graph API error subcodes (§10).
