# AI video & lip-sync module — design

**Status:** approved design, not yet implemented
**Date:** 2026-08-16
**Module name:** `lipsync` (avoids collision with existing `media` video handling)

---

## Scope

Generate ≤15s talking-head clips from speech audio, in two modes:

| Mode | Input | fal.ai model | Price |
|---|---|---|---|
| `avatar` | portrait image + audio | `fal-ai/kling-video/ai-avatar/v2/pro` | $0.115/s |
| `relip` | existing video + audio | `veed/lipsync` | $0.07/s |

> The avatar model id segment order is `ai-avatar/v2/pro`, **not**
> `v2/pro/ai-avatar`. An earlier draft of this doc had it backwards, which
> would have 404'd every avatar submission. Authoritative list lives in
> `providers/fal.py::MODE_MODELS`; verify against fal's live API reference
> before changing it.

**v1 is gated to the Cognito `admin` group.** No quota code. Job records are
user-scoped (`createdBy`) so opening the feature to `manager`/`user` later is a
gate change plus a counter, not a schema migration.

### Decisions already made (do not relitigate)

1. **Hosted API, not self-hosted.** At ~40 clips/month: fal.ai ≈ $42–69/mo vs a
   g5.xlarge idling at ~$734/mo. Self-hosting is 10–17x worse until volume is in
   the thousands.
2. **fal.ai as the single provider.** It hosts both model families behind one
   queue API and one key. sync.so was rejected as the primary because it is
   **video-redub only** — its API has no image input path, and lipsync-2/2-pro
   additionally require natural speaking motion already present in the source.
3. **Polling, not webhooks.** fal.ai supports `webhook_url`, but a webhook needs
   a public unauthenticated API Gateway route plus signature verification — new
   attack surface for no benefit at this volume. We reuse the self-scheduling
   poll pattern already proven in `social/publisher.py`.
4. **Do not use Wav2Lip.** Research-only license; commercial use explicitly
   prohibited by its authors.

---

## Architecture

Mirrors `src/lambda/social/` almost exactly. That module already solves
"submit to a third party, get a job id, poll until done" in production.

```
src/lambda/lipsync/
  __init__.py
  routes.py            # literal method+path dispatch (mirrors social/routes.py)
  storage.py           # DynamoDB item shapes + status machine
  media.py             # presign upload / presign GET for provider fetch
  secrets.py           # SSM parameter reads, module-level cache
  runner.py            # Lambda entry: submitJob + checkJob (the poll target)
  scheduling.py        # EventBridge one-shot self-scheduling
  maintenance.py       # daily reconciliation sweep
  providers/
    base.py            # LipsyncProvider ABC + PROVIDERS registry
    fal.py             # fal.ai queue API implementation
```

### Provider ABC

The seam that makes vendor swap additive. Mirrors `social/publishers/base.py`.

```python
class LipsyncProvider(ABC):
    name: str
    supportedModes: set[str]          # {"avatar", "relip"}

    @abstractmethod
    def validate(self, job: dict) -> None:
        """Raise ValidationError if inputs are unusable for this provider."""

    @abstractmethod
    def submit(self, job: dict, inputUrls: dict) -> SubmitResult:
        """Returns SubmitResult(providerJobId=..., statusUrl=...)."""

    @abstractmethod
    def checkStatus(self, providerJobId: str) -> StatusResult:
        """Returns StatusResult(state=..., outputUrl=..., error=...)."""
```

`PROVIDERS = {"fal": FalProvider()}` — registry dict, same idiom as `social`.

### fal.ai integration notes

- Base: `https://queue.fal.run/{model_id}`; auth header `Authorization: Key <FAL_KEY>`.
- Submit returns a `request_id`; poll `GET .../requests/{request_id}/status`,
  fetch result from `GET .../requests/{request_id}` when `status == "COMPLETED"`.
- **Inputs are passed as URLs, not bytes.** Generate presigned S3 GET URLs
  (TTL 3600s) and hand those to fal — same trick `social/publishers/instagram.py`
  uses to avoid loading media into a 128MB Lambda.
- **Output must be copied into our S3 bucket**, not linked. fal's result URLs are
  temporary. On completion, stream the output into
  `outputs/{jobId}/{jobId}.mp4` before marking the job `completed`.
- stdlib `urllib` only. No `requests`, no fal SDK. House style.

---

## Data model

New isolated DynamoDB table `lipsyncJobs` (matches the `socialPosts` precedent —
do **not** put these in the main table).

```
PK = JOB#{jobId}
SK = META
```

| Attribute | Notes |
|---|---|
| `jobId` | uuid4 |
| `mode` | `avatar` \| `relip` |
| `status` | see state machine below |
| `provider` | `fal` |
| `model` | provider model id actually used |
| `createdBy` | Cognito username — carried now, enforced later |
| `createdAt` / `updatedAt` | ISO8601 UTC |
| `imageKey` / `videoKey` / `audioKey` | S3 keys of inputs |
| `outputKey` | S3 key of the finished mp4 |
| `durationSec` | measured from output, used for cost attribution |
| `providerJobId` | fal `request_id` |
| `checkCount` | poll attempts so far |
| `statusKey` | **sparse** — present only while status is non-terminal |
| `expiresAt` | epoch seconds, DynamoDB TTL, 90 days |
| `consentAttested` | bool — likeness consent checkbox, see Compliance |
| `error` | failure reason, user-safe string |

**GSI `byStatusTime`** — hash `statusKey`, range `updatedAt`. Sparse: `statusKey`
is written only for non-terminal states and **removed** on terminal transition.
This is what the reconciliation sweep queries to find stuck jobs, and it keeps
the index tiny. Same trick as `social/storage.py`.

**GSI `byCreator`** — hash `createdBy`, range `createdAt`. Powers the list view
and, later, quota counting.

### Status machine

```
queued ──▶ submitting ──▶ processing ──▶ completed
   │            │              │
   └────────────┴──────────────┴────▶ failed
                                └────▶ cancelled
```

- `queued` — record written, nothing sent to the provider yet
- `submitting` — provider call in flight (guards against double-submit)
- `processing` — provider accepted, `providerJobId` known, polling
- terminal: `completed`, `failed`, `cancelled`

Transitions use DynamoDB **conditional writes** on the current status, so a
duplicate scheduler firing cannot double-submit or double-charge.

---

## Job lifecycle

1. Client presigns and PUTs inputs directly to S3.
2. `POST /lipsync/jobs` writes the record as `queued`, then **invokes the runner
   Lambda asynchronously** (`InvocationType="Event"`) and returns `{jobId}`
   immediately. The API request never waits on fal.
3. Runner (`submitJob`): conditional-write `queued → submitting`, presign input
   GETs, call `provider.submit()`, store `providerJobId`, move to `processing`,
   and schedule the first check.
4. Runner (`checkJob`): call `provider.checkStatus()`.
   - still running → increment `checkCount`, self-schedule the next check
   - completed → copy output to S3, write `outputKey` + `durationSec`, drop
     `statusKey`, status `completed`
   - failed → status `failed` with a user-safe `error`
5. Backoff: `15s, 15s, 30s, 30s, 60s, 60s, then 120s`, `MAX_CHECKS = 25`
   (~30 min ceiling). Exceeding it marks the job `failed` with a timeout error.
6. Daily reconciliation (`maintenance.py`, EventBridge cron) queries
   `byStatusTime` for non-terminal jobs older than 45 min, re-checks them
   idempotently, and publishes an SNS heartbeat **whether or not** anything was
   found — operational silence must itself be visible.

Sub-60s lead times schedule nothing and check inline, matching
`social/scheduling.py`'s `MIN_LEAD_SECONDS` behaviour.

---

## API contract (frozen — frontend and backend build against this)

All routes require the Cognito JWT authorizer **and** `admin` group membership.

| Method | Path | Body / params | Response |
|---|---|---|---|
| `POST` | `/lipsync/media/presign` | `{filename, contentType, kind}` where `kind ∈ image\|video\|audio` | `{uploadUrl, key}` |
| `POST` | `/lipsync/jobs` | `{mode, audioKey, imageKey?, videoKey?, model?, consentAttested}` | `{jobId, status}` |
| `GET` | `/lipsync/jobs` | `?status=&limit=&cursor=` | `{jobs: [...], cursor}` |
| `GET` | `/lipsync/jobs/{jobId}` | — | `{job}` |
| `DELETE` | `/lipsync/jobs/{jobId}` | — | `{jobId, status: "cancelled"}` |
| `GET` | `/lipsync/jobs/{jobId}/output` | — | `{url}` presigned GET, TTL 300s |

### Validation rules (enforced server-side, not just in the UI)

- `mode == "avatar"` requires `imageKey`, rejects `videoKey`
- `mode == "relip"` requires `videoKey`, rejects `imageKey`
- `audioKey` always required
- `consentAttested` must be `true` — reject with 400 otherwise
- Audio duration ≤ 20s (hard cap; 15s is the target, 20s is the ceiling).
  **Fails closed** — audio whose duration cannot be probed is rejected with a
  400, not waved through. The upload size cap cannot bound cost on its own:
  20MB of 128kbps mp3 is ~21 minutes, ≈$143 for one clip at Kling's rate.
  Since every allow-listed audio type is covered by the prober, a parse
  failure means a malformed file.
- Upload size caps at presign time: image ≤ 10MB, audio ≤ 20MB, video ≤ 100MB
- Content types allow-listed; extension derived from content type, never from
  the client-supplied filename

---

## Infrastructure (`infra/lipsync.tf`)

Modelled on `infra/social.tf`.

- `aws_s3_bucket.lipsyncMedia` — CORS for `PUT`/`GET`/`HEAD`; lifecycle expiry at
  **90 days** on both `uploads/` and `outputs/`
- `aws_dynamodb_table.lipsyncJobs` — PK/SK, GSIs `byStatusTime` + `byCreator`,
  TTL on `expiresAt`
- `aws_lambda_function.lipsyncRunner` — the submit/poll worker
- `aws_scheduler_schedule_group.lipsync` + `aws_iam_role.lipsyncScheduler`,
  scoped to `lambda:InvokeFunction` on the runner only
- `aws_cloudwatch_event_rule.lipsyncReconcile` — daily cron
- `aws_sns_topic.lipsyncAlerts` — heartbeat + failure notifications
- `aws_apigatewayv2_route` per API route above — **required**, see below
- IAM: `ssm:GetParameter*` scoped to `/funkedupshift/lipsync/*` with a
  `kms:ViaService` condition restricting decrypt to SSM

### Credentials

```
/funkedupshift/lipsync/fal/api-key     (SecureString)
```

Set manually by the repo owner — **not** committed, not created by Terraform.

### Route-coverage tripwire

Every literal route in `routes.py` must have a matching `aws_apigatewayv2_route`
in Terraform. `src/lambda/tests/test_route_coverage.py` enforces this. A handler
route with no gateway route 404s **without CORS headers**, which surfaces in the
browser as an unhelpful "Failed to fetch".

### Deploy gotchas (from CLAUDE.md, previously cost a failed deploy)

- New Python deps need **two** homes: the Lambda layer and
  `src/lambda/requirements-test.txt`. This module should need neither — stdlib
  only — but if that changes, both must be updated.
- `aws_lambda_layer_version` does not republish when its zip is rebuilt.

---

## Frontend (`src/web/spa/src/features/lipsync/`)

- Route `/lipsync` registered in `src/web/spa/src/shell/AppLayout.tsx`
- Entry in `src/web/spa/src/config/modules.ts` with `minRole: "superadmin"`

> **Naming trap:** the Cognito *group* is `admin`, but the frontend `UserRole`
> type has no `"admin"` literal — `AuthContext.mapGroupsToRole` maps the Cognito
> `admin` group to the frontend role `"superadmin"`. Backend code checks the
> Cognito group `admin`; frontend code checks the role `superadmin`. A nav
> `minRole` flag only hides the link, so route protection needs a `LipsyncGate`
> component mirroring `SocialGate`.
- Pages: `LipsyncPage.tsx` (create + list), `JobDetail.tsx` (status + playback)
- Upload uses `XMLHttpRequest` for `upload.onprogress`, copying
  `features/social/api.ts::uploadFileToS3` — `fetch` cannot report upload progress
- Polling copies `features/social/CalendarPage.tsx`: interval runs **only** when
  a job is non-terminal **and** the tab is visible; also refetch on
  `visibilitychange`

---

## Compliance

These are requirements, not nice-to-haves. v1 is admin-only, which lowers the
risk, but the controls go in now because opening the gate later is a one-line
change and it would be easy to forget.

1. **Likeness consent.** The create form carries an explicit attestation
   checkbox ("I have the right to use this likeness"). Stored as
   `consentAttested` on the job record and enforced server-side.
2. **AI disclosure.** Output clips are labelled as AI-generated in the UI, and
   the job record is the audit trail. Instagram, TikTok and YouTube all require
   disclosure for realistic synthetic media — relevant because this module will
   feed the existing social scheduling module.
3. **Retention.** 90-day expiry matches the social media bucket. The UI must
   **show the expiry date on each clip** — silent deletion of a user's work is a
   bug, not a policy.
