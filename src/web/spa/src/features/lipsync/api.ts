import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

/* ── Types ─────────────────────────────────────────────────────────── */

export type LipsyncMode = "avatar" | "relip";

export type LipsyncJobStatus =
  | "queued"
  | "submitting"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type MediaKind = "image" | "video" | "audio";

/**
 * Job record as returned by the read endpoints. Mirrors the DynamoDB item
 * shape in docs/lipsync-design.md's Data model section, minus `statusKey`
 * (an internal sparse-GSI bookkeeping field with no UI meaning).
 *
 * Most fields beyond the always-present ones are optional: `imageKey` XOR
 * `videoKey` depending on `mode`, `outputKey`/`durationSec` only appear after
 * completion, `error` only after failure.
 */
export interface LipsyncJob {
  jobId: string;
  mode: LipsyncMode;
  status: LipsyncJobStatus;
  provider: string;
  model?: string;
  createdBy?: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  /** ISO-8601 UTC. */
  updatedAt: string;
  imageKey?: string;
  videoKey?: string;
  audioKey?: string;
  /** Present only when the job's model accepts a prompt AND one was supplied. Absent on jobs created before this field existed. */
  prompt?: string;
  outputKey?: string;
  durationSec?: number;
  providerJobId?: string;
  checkCount?: number;
  /**
   * DynamoDB TTL attribute — epoch SECONDS, not milliseconds and not ISO.
   * Multiply by 1000 before handing to `Date`. See dateUtils.ts::formatExpiry.
   */
  expiresAt?: number;
  consentAttested: boolean;
  error?: string;
}

const TERMINAL_STATUSES: ReadonlySet<LipsyncJobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalStatus(status: LipsyncJobStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface PresignRequest {
  filename: string;
  contentType: string;
  kind: MediaKind;
}

export interface PresignResponse {
  uploadUrl: string;
  key: string;
}

export interface CreateJobInput {
  mode: LipsyncMode;
  audioKey: string;
  imageKey?: string;
  videoKey?: string;
  model?: string;
  /** Only meaningful for models that accept it -- see MODEL_CATALOG in statusStyles.ts. */
  prompt?: string;
  consentAttested: boolean;
}

export interface CreateJobResponse {
  jobId: string;
  status: LipsyncJobStatus;
}

export interface ListJobsParams {
  status?: LipsyncJobStatus;
  limit?: number;
  cursor?: string;
}

export interface ListJobsResponse {
  jobs: LipsyncJob[];
  cursor: string | null;
}

export interface CancelJobResponse {
  jobId: string;
  status: LipsyncJobStatus;
}

/**
 * Budget types mirror docs/lipsync-design.md's "Budgets and spend control"
 * section. All money fields are integer cents -- format with
 * features/lipsync/money.ts, never with a raw toFixed.
 */
export interface LipsyncBudget {
  budgetCents: number;
  spentCents: number;
  reservedCents: number;
  remainingCents: number;
}

/** One row of GET /lipsync/admin/budgets's `budgets` array. */
export interface AdminUserBudget {
  username: string;
  budgetCents: number;
  spentCents: number;
  reservedCents: number;
  remainingCents: number;
  /** ISO-8601 UTC, absent for a user who has never been granted a budget. */
  updatedAt?: string;
  updatedBy?: string;
  note?: string;
}

export interface AdminBudgetsResponse {
  budgets: AdminUserBudget[];
  /** null when fal's account API was unreachable -- render "unavailable", never a misleading $0.00. */
  falBalanceCents: number | null;
  /** ISO-8601 UTC, null alongside falBalanceCents. */
  falBalanceFetchedAt: string | null;
  totalGrantedCents: number;
  totalSpentCents: number;
}

export interface UpdateBudgetInput {
  budgetCents: number;
  note?: string;
}

export interface UpdateBudgetResponse {
  username: string;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
}

export class ApiError extends Error {
  status: number;
  errors?: string[];
  constructor(message: string, status: number, errors?: string[]) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const d = data as { error?: string; errors?: string[] };
    const message =
      d.error ??
      (Array.isArray(d.errors) && d.errors.length ? d.errors.join("; ") : null) ??
      `Request failed (${resp.status})`;
    throw new ApiError(message, resp.status, d.errors);
  }
  return data as T;
}

function requireBase(): string {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  return base;
}

/* ── Reads ─────────────────────────────────────────────────────────── */

/** GET /lipsync/jobs?status=&limit=&cursor= */
export async function listJobs(params: ListJobsParams = {}): Promise<ListJobsResponse> {
  const base = requireBase();
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const resp = await fetchWithAuth(`${base}/lipsync/jobs${suffix}`);
  const data = await parseJsonOrThrow<{ jobs?: LipsyncJob[]; cursor?: string | null }>(resp);
  return { jobs: data.jobs ?? [], cursor: data.cursor ?? null };
}

/** GET /lipsync/jobs/{jobId} */
export async function getJob(jobId: string): Promise<LipsyncJob> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/jobs/${encodeURIComponent(jobId)}`);
  const data = await parseJsonOrThrow<{ job: LipsyncJob }>(resp);
  return data.job;
}

/**
 * GET /lipsync/jobs/{jobId}/output — presigned GET, TTL 300s. Fetch fresh
 * right before you need it; don't stash the result for long (see
 * JobDetail.tsx's "Reload video" fallback for what happens once it goes stale).
 */
export async function getJobOutputUrl(jobId: string): Promise<string> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/jobs/${encodeURIComponent(jobId)}/output`);
  const data = await parseJsonOrThrow<{ url: string }>(resp);
  return data.url;
}

/**
 * GET /lipsync/budget — the caller's own budget. A brand-new user may have
 * no budget record at all; callers should treat a 404 ApiError the same as
 * a zero budget rather than surfacing it as an error (see
 * docs/lipsync-design.md: "no budget record at all, which means $0").
 */
export async function getBudget(): Promise<LipsyncBudget> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/budget`);
  return parseJsonOrThrow<LipsyncBudget>(resp);
}

/* ── Writes ────────────────────────────────────────────────────────── */

/** POST /lipsync/jobs */
export async function createJob(input: CreateJobInput): Promise<CreateJobResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<CreateJobResponse>(resp);
}

/** DELETE /lipsync/jobs/{jobId} — cancels a non-terminal job. */
export async function cancelJob(jobId: string): Promise<CancelJobResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
  return parseJsonOrThrow<CancelJobResponse>(resp);
}

/** POST /lipsync/media/presign */
export async function presignMedia(input: PresignRequest): Promise<PresignResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/media/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<PresignResponse>(resp);
}

/**
 * PUT the file bytes directly to S3 using a presigned URL. Never proxied
 * through the API. Uses XHR (not fetch) so upload progress can be reported —
 * copied verbatim from features/social/api.ts::uploadFileToS3.
 */
export function uploadFileToS3(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (evt) => {
      if (onProgress && evt.lengthComputable) onProgress(evt.loaded / evt.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });
}

/* ── Admin (Cognito `admin` group / frontend "superadmin" role only) ─── */

/** GET /lipsync/admin/budgets — every user's budget, plus the live fal balance and totals. */
export async function listAdminBudgets(): Promise<AdminBudgetsResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/admin/budgets`);
  const data = await parseJsonOrThrow<Partial<AdminBudgetsResponse>>(resp);
  return {
    budgets: data.budgets ?? [],
    falBalanceCents: data.falBalanceCents ?? null,
    falBalanceFetchedAt: data.falBalanceFetchedAt ?? null,
    totalGrantedCents: data.totalGrantedCents ?? 0,
    totalSpentCents: data.totalSpentCents ?? 0,
  };
}

/** PUT /lipsync/admin/budgets/{username} — grant/adjust one user's budget. */
export async function updateUserBudget(username: string, input: UpdateBudgetInput): Promise<UpdateBudgetResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/lipsync/admin/budgets/${encodeURIComponent(username)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<UpdateBudgetResponse>(resp);
}


// --- user lookup (for the budget grant form's autocomplete) --------------------------

export interface DirectoryUser {
  username: string;
  email: string;
}

/**
 * Users from the MAIN app's admin API, not the lipsync module.
 *
 * The lipsync Lambda is deliberately isolated -- it has no Cognito access and
 * no reach into the main app's table (see infra/lipsync.tf's isolation
 * comment), so it cannot enumerate users itself. The SPA can, because
 * `GET /admin/users` already exists and the same JWT authorises both.
 *
 * Used ONLY to populate a datalist. A budget can still be granted to an email
 * that isn't in this list -- that is the point of keying budgets on email
 * rather than on a Cognito sub, so an admin can allocate to someone before
 * their first sign-in. Failure here degrades to "no suggestions", never to a
 * blocked form.
 */
export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
  const base = getApiBaseUrl();
  if (!base) return [];
  try {
    const resp = await fetchWithAuth(`${base}/admin/users?limit=100`);
    if (!resp.ok) return [];
    const data = (await resp.json()) as { users?: Array<{ username?: string; email?: string }> };
    return (data.users ?? [])
      .map((u) => ({ username: u.username ?? "", email: u.email ?? "" }))
      .filter((u) => u.email);
  } catch {
    return [];
  }
}
