import { fetchWithAuth } from "../../utils/api";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

/* ── Types ─────────────────────────────────────────────────────────── */

/** Status of an individual per-account publish target. */
// "processing" is a non-terminal TARGET status only (see STATUS_PROCESSING in
// src/lambda/social/storage.py): Instagram has accepted the media and is
// transcoding it server-side while an EventBridge check polls for completion.
// A parent post rolls that up to "publishing", so it never appears as a
// PostStatus.
export type TargetStatus =
  | "pending"
  | "publishing"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

/**
 * Status of the parent post. `partial` only ever appears here (mixed target
 * outcomes), and `processing` never does — deriveParentStatus rolls a
 * processing target up to `publishing`. Spelled out rather than derived from
 * TargetStatus so those two asymmetries stay visible.
 */
export type PostStatus =
  | "pending"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled"
  | "partial";

export interface SocialAccount {
  platform: string;
  accountId: string;
  handle: string;
}

export interface PostTarget {
  platform: string;
  accountId: string;
  status: TargetStatus;
  permalink?: string | null;
  lastError?: string | null;
  attemptCount?: number;
}

/** Flat post shape returned by the month listing. */
export interface SocialPost {
  postId: string;
  text: string;
  /** UTC ISO-8601 with a trailing Z. */
  scheduledAt: string;
  status: PostStatus;
  monthKey: string;
  targets: PostTarget[];
}

export interface SocialPostParent {
  postId: string;
  text: string;
  scheduledAt: string;
  status: PostStatus;
  monthKey: string;
}

/** Shape returned by the single-post endpoints (create/get/delete/retry). */
export interface SocialPostDetail {
  parent: SocialPostParent;
  targets: PostTarget[];
}

export interface CreatePostAccountInput {
  platform: string;
  accountId: string;
  overrides?: { text?: string };
}

export interface CreatePostInput {
  text: string;
  /** UTC ISO-8601 with a trailing Z. */
  scheduledAt: string;
  accounts: CreatePostAccountInput[];
  mediaKeys?: string[];
  links?: string[];
}

export interface PresignRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
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

/** GET /social/accounts */
export async function listAccounts(): Promise<SocialAccount[]> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/accounts`);
  const data = await parseJsonOrThrow<{ accounts: SocialAccount[] }>(resp);
  return data.accounts ?? [];
}

/** GET /social/posts?month=YYYY-MM */
export async function listPosts(month: string): Promise<SocialPost[]> {
  const base = requireBase();
  const params = new URLSearchParams({ month });
  const resp = await fetchWithAuth(`${base}/social/posts?${params.toString()}`);
  const data = await parseJsonOrThrow<{ posts: SocialPost[] }>(resp);
  return data.posts ?? [];
}

/** GET /social/posts/{postId} */
export async function getPost(postId: string): Promise<SocialPostDetail> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/posts/${encodeURIComponent(postId)}`);
  const data = await parseJsonOrThrow<{ post: SocialPostDetail }>(resp);
  return data.post;
}

/* ── Writes ────────────────────────────────────────────────────────── */

/** POST /social/posts */
export async function createPost(
  input: CreatePostInput
): Promise<{ postId: string; post: SocialPostDetail }> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<{ postId: string; post: SocialPostDetail }>(resp);
}

/** DELETE /social/posts/{postId} — cancels a pending post. */
export async function deletePost(
  postId: string
): Promise<{ postId: string; post: SocialPostDetail }> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/posts/${encodeURIComponent(postId)}`, {
    method: "DELETE",
  });
  return parseJsonOrThrow<{ postId: string; post: SocialPostDetail }>(resp);
}

/** POST /social/posts/{postId}/retry — omit target to retry every failed target. */
export async function retryPost(
  postId: string,
  target?: { platform: string; accountId: string }
): Promise<{ postId: string; post: SocialPostDetail }> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/posts/${encodeURIComponent(postId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target ?? {}),
  });
  return parseJsonOrThrow<{ postId: string; post: SocialPostDetail }>(resp);
}

/** POST /social/media/presign */
export async function presignMedia(input: PresignRequest): Promise<PresignResponse> {
  const base = requireBase();
  const resp = await fetchWithAuth(`${base}/social/media/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<PresignResponse>(resp);
}

/**
 * PUT the file bytes directly to S3 using a presigned URL. Never proxied through
 * the API. Uses XHR (not fetch) so upload progress can be reported.
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
