// Shortener API client. Deliberately NOT imported from src/web/spa — this app
// is a standalone deploy, so it carries its own thin copy of the request/
// response shapes and fetch wrapper (see src/web/spa/src/features/tools/api.ts
// and src/web/spa/src/utils/api.ts for the source of truth this mirrors).
// Difference from the SPA's fetchWithAuth: no impersonation headers — not
// relevant to this app.
import { partRanges, retryDelayMs } from "./filedrop";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

/** Fetch with the signed-in user's bearer token. Throws "Not signed in" /
 * "Session expired — please sign in again" instead of ever firing an
 * unauthenticated request — callers (and the UI gating) rely on this. */
async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const w = window as any;
  if (!w.auth?.getAccessToken) throw new Error("Not signed in");
  const token: string | null = await new Promise((resolve) => w.auth.getAccessToken(resolve));
  if (!token) throw new Error("Session expired — please sign in again");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    Authorization: `Bearer ${token}`
  };
  return fetch(url, { ...options, headers });
}

export interface ShortLink {
  code: string;
  url: string;
  shortUrl: string;
  /** ISO 8601 string. */
  createdAt: string;
  /** Epoch seconds. */
  expiresAt: number;
  /** Presigned GET (~1h) for the saved QR image; absent when none is saved. */
  qrUrl?: string;
  /** ISO 8601 string; present iff qrUrl is. */
  qrUpdatedAt?: string;
}

export interface ShortLinkPage {
  items: ShortLink[];
  nextCursor: string | null;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
}

// ponytail: the backend mints fus.fyi shortUrls (SHORT_DOMAIN env var on the
// tools Lambda); this site brands them as e9.cx. Both hosts resolve on the
// same distribution/KVS, so a host swap is purely cosmetic.
const BRAND_HOST = "https://e9.cx";

function brand(link: ShortLink): ShortLink {
  return { ...link, shortUrl: link.shortUrl.replace(/^https?:\/\/[^/]+/, BRAND_HOST) };
}

/** POST /s — mint a short link for `url`. Throws with the API's error message on failure. */
export async function mintShortLink(url: string): Promise<ShortLink> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  return brand(await parseJsonOrThrow<ShortLink>(resp));
}

/** GET /s — the caller's own links, newest first. Pass `cursor` (from a prior
 * response's `nextCursor`) to fetch the next page. */
export async function listLinks(cursor?: string | null): Promise<ShortLinkPage> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetchWithAuth(`${base}/s${qs ? `?${qs}` : ""}`);
  const page = await parseJsonOrThrow<ShortLinkPage>(resp);
  return { ...page, items: page.items.map(brand) };
}

/** DELETE /s/{code} — only the creator may delete. */
export async function deleteLink(code: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** PATCH /s/{code} — set a new expiry (epoch seconds, must be in the future). */
export async function updateExpiry(code: string, expiresAt: number): Promise<ShortLink> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresAt })
  });
  return brand(await parseJsonOrThrow<ShortLink>(resp));
}

/** Save (or replace) the QR image for a short link: POST /s/{code}/qr returns
 * a presigned S3 POST (5 MB cap enforced by its policy), the browser uploads
 * straight to S3 (no auth header — the policy is the credential), then
 * PUT /s/{code}/qr confirms and records it. Resolves to the fresh qrUrl. */
export async function saveQr(code: string, png: Blob): Promise<{ qrUrl?: string; qrUpdatedAt?: string }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const path = `${base}/s/${encodeURIComponent(code)}/qr`;
  const presign = await parseJsonOrThrow<{ uploadUrl: string; fields: Record<string, string> }>(
    await fetchWithAuth(path, { method: "POST" })
  );
  const form = new FormData();
  Object.entries(presign.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", png); // must be the last field for S3
  const up = await fetch(presign.uploadUrl, { method: "POST", body: form });
  if (!up.ok) throw new Error(up.status === 400 ? "QR image rejected (too large?)" : `Upload failed (${up.status})`);
  return parseJsonOrThrow<{ qrUrl?: string; qrUpdatedAt?: string }>(await fetchWithAuth(path, { method: "PUT" }));
}

/** DELETE /s/{code}/qr — remove the saved QR image. */
export async function deleteQr(code: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/s/${encodeURIComponent(code)}/qr`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** True for the "not signed in" / "session expired" errors thrown above —
 * callers use this to flip the UI back to the unauthed/auth view rather
 * than showing a generic error banner. */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "Not signed in" || msg.startsWith("Session expired");
}

// --- DNS lookup tool -------------------------------------------------------

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SOA" | "SRV" | "CAA" | "PTR";

export const DNS_RECORD_TYPES: DnsRecordType[] = [
  "A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA", "PTR"
];

export type DnsStatus = "ok" | "nxdomain" | "noanswer" | "timeout";

export interface DnsRecord {
  record: string;
  ttl: number;
  value: string;
}

export interface DnsResult {
  name: string;
  type: DnsRecordType;
  records: DnsRecord[];
  status: DnsStatus;
}

/** GET /tools/dns?name=&type= — a single typed DNS query. "All types" fan-out
 * (one request per type) is a client-side concern; see DnsTool.tsx. */
export async function dnsLookup(name: string, type: DnsRecordType): Promise<DnsResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ name, type });
  const resp = await fetchWithAuth(`${base}/tools/dns?${params.toString()}`);
  return parseJsonOrThrow<DnsResult>(resp);
}

// --- email auth checker (FUNK-75) -------------------------------------------

export type EmailAuthSeverity = "high" | "medium" | "low";

export interface EmailAuthFix {
  severity: EmailAuthSeverity;
  message: string;
}

export interface SpfNode {
  domain: string;
  via: "include" | "redirect" | null;
  record: string | null;
  error: string | null;
  children: SpfNode[];
}

export interface EmailAuthResult {
  domain: string;
  grade: "A" | "B" | "C" | "D" | "F";
  fixes: EmailAuthFix[];
  spf: {
    present: boolean;
    record: string | null;
    recordCount: number;
    mechanisms: { qualifier: string; mechanism: string; value: string }[];
    modifiers: { name: string; value: string }[];
    all: string | null;
    lookupCount: number;
    tree: SpfNode | null;
    errors: string[];
    notes: string[];
  };
  dmarc: { present: boolean; record: string | null; tags: Record<string, string>; error: string | null };
  dkim: {
    selector: string;
    found: boolean;
    keyType: string | null;
    keyBits: number | null;
    warnings: string[];
  }[];
  mx: { preference: number; host: string }[];
  mtaSts: { present: boolean; record: string | null };
  tlsRpt: { present: boolean; record: string | null };
  bimi: { present: boolean; record: string | null };
  warnings: string[];
}

/** GET /tools/emailauth?domain=&selectors= — SPF/DKIM/DMARC/MX report (see tools/emailauth.py). */
export async function emailAuthCheck(domain: string, selectors: string): Promise<EmailAuthResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ domain });
  if (selectors) params.set("selectors", selectors);
  const resp = await fetchWithAuth(`${base}/tools/emailauth?${params.toString()}`);
  return parseJsonOrThrow<EmailAuthResult>(resp);
}

export interface SslCert {
  subject: string;
  issuer: string;
  sans: { dns: string[]; ip: string[] };
  serial: string;
  signatureHash: string | null;
  keyType: string;
  keySize: number | null;
  notBefore: string;
  notAfter: string;
  selfSigned: boolean;
}

export interface SslResult {
  host: string;
  port: number;
  ip: string;
  status: "ok" | "warning" | "error";
  trusted: boolean;
  trustError: string | null;
  hostnameMatch: boolean;
  tlsVersion: string;
  cipher: string;
  daysLeft: number;
  /** Leaf first. */
  chain: SslCert[];
}

export const SSL_PORTS = [443, 465, 636, 853, 990, 993, 995, 5061, 8443];

/** GET /tools/ssl?host=&port= — TLS certificate report (see tools/sslcheck.py). */
export async function sslCheck(host: string, port: number): Promise<SslResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams({ host, port: String(port) });
  const resp = await fetchWithAuth(`${base}/tools/ssl?${params.toString()}`);
  return parseJsonOrThrow<SslResult>(resp);
}

export interface HttpHop {
  url: string;
  /** Absent when the hop failed before a request was made. */
  method?: "HEAD" | "GET";
  status?: number;
  reason?: string;
  httpVersion?: string;
  location?: string | null;
  nextUrl?: string | null;
  timeMs?: number;
  ip?: string | null;
  /** [name, value] pairs in received order (repeats kept). */
  headers?: [string, string][];
  truncated?: boolean;
  error?: string;
}

export interface HttpSecurityEntry {
  name: string;
  present: boolean;
  value: string | null;
  ok: boolean;
  note: string;
}

export interface HttpTraceResult {
  input: string;
  hops: HttpHop[];
  stopReason: "final response" | "redirect loop" | "too many redirects" | "error" | "timed out";
  finalUrl: string | null;
  finalStatus: number | null;
  totalMs: number;
  /** security, securityGrade, cache and cdn are omitted when no hop got a response. */
  security?: HttpSecurityEntry[];
  securityGrade?: "A" | "B" | "C" | "D" | "F";
  cache?: Record<string, string>;
  cdn?: { detected: string[]; server: string | null; poweredBy: string | null };
}

/** GET /tools/http?url= — redirect chain and header report (see tools/httptrace.py). */
export async function httpTrace(url: string): Promise<HttpTraceResult> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/http?${new URLSearchParams({ url }).toString()}`);
  return parseJsonOrThrow<HttpTraceResult>(resp);
}

// --- text-paste sharing (FUNK-40) -------------------------------------------

// The public-facing host for share links. Both frontends brand text-share
// URLs this way (tools.e9.cx is the public directory site), even though this
// app itself is served there — mirrors BRAND_HOST above for short links.
export const TEXT_SHARE_HOST = "https://tools.e9.cx";

export interface TextPasteSummary {
  id: string;
  kind: "text";
  /** ISO 8601 string. */
  createdAt: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface TextPasteMinted {
  id: string;
  kind: "text";
  createdAt: string;
  expiresAt: number;
  shareUrl: string;
}

export interface TextPastePublic {
  id: string;
  kind: "text";
  content: string;
  /** Epoch seconds. */
  expiresAt: number;
}

function shareUrlFor(id: string): string {
  return `${TEXT_SHARE_HOST}/t/${id}`;
}

/** POST /tools/text — mint a text paste. `expiresInSeconds` must be between
 * 1 hour (3600) and 30 days (2592000); omit for the 7-day server default. */
export async function mintTextPaste(content: string, expiresInSeconds?: number): Promise<TextPasteMinted> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expiresInSeconds ? { content, expiresInSeconds } : { content })
  });
  const paste = await parseJsonOrThrow<Omit<TextPasteMinted, "shareUrl">>(resp);
  return { ...paste, shareUrl: shareUrlFor(paste.id) };
}

/** GET /tools/text — the caller's own pastes, newest first. */
export async function listTextPastes(cursor?: string | null): Promise<{ items: TextPasteSummary[]; nextCursor: string | null }> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const resp = await fetchWithAuth(`${base}/tools/text${qs ? `?${qs}` : ""}`);
  return parseJsonOrThrow(resp);
}

/** DELETE /tools/text/{id} — creator only. */
export async function deleteTextPaste(id: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetchWithAuth(`${base}/tools/text/${encodeURIComponent(id)}`, { method: "DELETE" });
  await parseJsonOrThrow<{ deleted: boolean }>(resp);
}

/** GET /tools/text/{id} — PUBLIC. Plain fetch, no auth token — this must
 * work for a signed-out visitor who just opened a shared link. A 404
 * (unknown or expired paste) throws "Not found". */
export async function getPublicTextPaste(id: string): Promise<TextPastePublic> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetch(`${base}/tools/text/${encodeURIComponent(id)}`);
  return parseJsonOrThrow<TextPastePublic>(resp);
}

// --- visitor network info (My Info tool) ------------------------------------
// Mirrors src/web/spa/src/features/myinfo/MyInfoPage.tsx's IpWhoResponse.

export interface IpWhoConnection {
  asn?: number;
  org?: string;
  isp?: string;
  domain?: string;
}

export interface IpWhoTimezone {
  id?: string;
  abbr?: string;
  utc?: string;
  offset?: number;
  is_dst?: boolean;
}

export interface IpWhoResponse {
  success?: boolean;
  message?: string;
  ip?: string;
  type?: string;
  continent?: string;
  country?: string;
  country_code?: string;
  region?: string;
  city?: string;
  postal?: string;
  latitude?: number;
  longitude?: number;
  is_eu?: boolean;
  calling_code?: string;
  connection?: IpWhoConnection;
  timezone?: IpWhoTimezone;
}

/** GET /visitor-network-info — PUBLIC, no auth. Same backend endpoint the
 * SPA's My Info page calls; this tool must work for signed-out visitors. */
export async function fetchVisitorNetworkInfo(): Promise<IpWhoResponse> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetch(`${base}/visitor-network-info`);
  const json = (await resp.json().catch(() => ({}))) as IpWhoResponse & { error?: string };
  if (!resp.ok) throw new Error(json.message || json.error || `Request failed (${resp.status})`);
  return json;
}

// --- File Drop (FUNK-76) ----------------------------------------------------
// Everything below is duplicated verbatim in both frontends (tools-site
// src/api.ts and spa features/files/api.ts); keep the two in sync.

export type FileExpiry = "1h" | "1d" | "7d" | "30d";
export type FileStatus = "uploading" | "ready" | "failed";

export interface FileDropOptions {
  expiry: FileExpiry;
  password?: string;
  oneTime?: boolean;
}

export interface FileInitiated {
  id: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  /** Epoch seconds; provisional until complete. */
  expiresAt: number;
}

export interface FileCompleted {
  id: string;
  status: "ready";
  size: number;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface FileSummary {
  id: string;
  name: string;
  size: number;
  status: FileStatus;
  /** Epoch seconds. */
  expiresAt: number;
  createdAt: string;
  hasPassword: boolean;
  oneTime: boolean;
  downloadCount: number;
}

export interface FileUsage {
  count: number;
  bytes: number;
  maxCount: number;
  maxBytes: number;
}

export interface FileList {
  files: FileSummary[];
  usage: FileUsage;
}

export interface PublicFile {
  name: string;
  size: number;
  /** Epoch seconds. */
  expiresAt: number;
  hasPassword: boolean;
  oneTime: boolean;
}

export interface FileDownload {
  url: string;
  name: string;
  size: number;
}

export const FILE_MAX_BYTES = 5 * 1024 ** 3;
export const FILE_TOO_LARGE_MESSAGE = "File too large: max 5 GB";
const PART_BATCH = 100;
const PART_CONCURRENCY = 4;
const PART_RETRIES = 3;

function filesBase(): string {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  return `${base}/tools/files`;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function initiateFile(file: { name: string; size: number; type: string }, opts: FileDropOptions): Promise<FileInitiated> {
  const body: Record<string, unknown> = { name: file.name, size: file.size, expiry: opts.expiry, oneTime: !!opts.oneTime };
  if (file.type) body.contentType = file.type;
  if (opts.password) body.password = opts.password;
  return parseJsonOrThrow<FileInitiated>(await fetchWithAuth(filesBase(), jsonInit("POST", body)));
}

export async function requestPartUrls(id: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]> {
  const data = await parseJsonOrThrow<{ urls: { partNumber: number; url: string }[] }>(
    await fetchWithAuth(`${filesBase()}/${encodeURIComponent(id)}/parts`, jsonInit("POST", { partNumbers }))
  );
  return data.urls;
}

export async function completeFile(id: string, parts: { partNumber: number; etag: string }[]): Promise<FileCompleted> {
  return parseJsonOrThrow<FileCompleted>(
    await fetchWithAuth(`${filesBase()}/${encodeURIComponent(id)}/complete`, jsonInit("POST", { parts }))
  );
}

export async function deleteFile(id: string): Promise<void> {
  await parseJsonOrThrow<{ deleted: boolean }>(
    await fetchWithAuth(`${filesBase()}/${encodeURIComponent(id)}`, { method: "DELETE" })
  );
}

export async function listFiles(): Promise<FileList> {
  return parseJsonOrThrow<FileList>(await fetchWithAuth(filesBase()));
}

export interface FileUpload {
  /** Resolves with the completed file; rejects on failure or cancel. */
  promise: Promise<FileCompleted>;
  /** Aborts in-flight parts, stops the queue, then deletes the upload. */
  cancel: () => void;
}

export const UPLOAD_CANCELLED = "Upload cancelled";

/** Multipart upload straight to S3 via presigned part URLs. XHR (not fetch)
 * because fetch has no upload progress. Content-Length/Content-Type are NOT
 * set: the URL signs content-length and the browser derives it from the Blob.
 * `onProgress` gets acknowledged bytes (per part capped at the part's size). */
export function startUpload(file: File, opts: FileDropOptions, onProgress: (loaded: number, total: number) => void): FileUpload {
  let stopped = false;
  const xhrs = new Set<XMLHttpRequest>();
  const abortAll = () => xhrs.forEach((x) => x.abort());

  const run = async (): Promise<FileCompleted> => {
    if (file.size > FILE_MAX_BYTES) throw new Error(FILE_TOO_LARGE_MESSAGE);
    let id: string | null = null;
    try {
      const init = await initiateFile(file, opts);
      id = init.id;
      if (stopped) throw new Error(UPLOAD_CANCELLED);
      const ranges = partRanges(file.size, init.partSize);
      const loaded = new Array<number>(ranges.length).fill(0);
      const etags = new Array<string>(ranges.length);
      const report = () => onProgress(loaded.reduce((a, b) => a + b, 0), file.size);
      report();

      // Part URLs are fetched lazily, a batch at a time; calls are chained so
      // concurrent workers share one request instead of racing.
      const urls = new Map<number, string>();
      let urlChain: Promise<unknown> = Promise.resolve();
      const urlFor = (partNumber: number, refresh: boolean): Promise<string> => {
        const step = urlChain.then(async () => {
          if (refresh || !urls.has(partNumber)) {
            const wanted: number[] = [];
            const last = refresh ? partNumber : Math.min(partNumber + PART_BATCH - 1, ranges.length);
            for (let n = partNumber; n <= last; n++) if (refresh || !urls.has(n)) wanted.push(n);
            for (const u of await requestPartUrls(id as string, wanted)) urls.set(u.partNumber, u.url);
          }
          const url = urls.get(partNumber);
          if (!url) throw new Error(`No upload URL for part ${partNumber}`);
          return url;
        });
        urlChain = step.catch(() => undefined);
        return step;
      };

      const putPart = (url: string, r: { partNumber: number; start: number; end: number }) =>
        new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.add(xhr);
          const done = () => xhrs.delete(xhr);
          const fail = (message: string, status = 0, fatal = false) => {
            done();
            reject(Object.assign(new Error(message), { status, fatal }));
          };
          xhr.upload.onprogress = (e) => {
            loaded[r.partNumber - 1] = Math.min(e.loaded, r.end - r.start);
            report();
          };
          xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) return fail(`Part ${r.partNumber} failed (${xhr.status})`, xhr.status);
            const etag = xhr.getResponseHeader("ETag");
            if (!etag) return fail("Upload could not be verified: the storage server did not return an ETag", 0, true);
            done();
            resolve(etag);
          };
          xhr.onerror = () => fail(`Part ${r.partNumber} failed (network error)`);
          xhr.onabort = () => fail(UPLOAD_CANCELLED, 0, true);
          xhr.open("PUT", url);
          xhr.send(file.slice(r.start, r.end));
        });

      const uploadPart = async (r: { partNumber: number; start: number; end: number }) => {
        let refreshed = false;
        let url = await urlFor(r.partNumber, false);
        for (let attempt = 1; ; attempt++) {
          if (stopped) throw new Error(UPLOAD_CANCELLED);
          try {
            return await putPart(url, r);
          } catch (err) {
            loaded[r.partNumber - 1] = 0;
            report();
            const e = err as Error & { status?: number; fatal?: boolean };
            if (stopped || e.fatal) throw e;
            if (e.status === 403 && !refreshed) {
              // Presigned URL expired: mint a fresh one once, no backoff.
              refreshed = true;
              url = await urlFor(r.partNumber, true);
              continue;
            }
            if (attempt > PART_RETRIES) {
              throw new Error(`Upload failed: part ${r.partNumber} of ${ranges.length} could not be uploaded after ${PART_RETRIES} retries`);
            }
            await new Promise((res) => setTimeout(res, retryDelayMs(attempt)));
          }
        }
      };

      let next = 0;
      let failure: Error | null = null;
      const worker = async () => {
        while (!stopped && next < ranges.length) {
          const r = ranges[next++];
          try {
            etags[r.partNumber - 1] = await uploadPart(r);
            loaded[r.partNumber - 1] = r.end - r.start;
            report();
          } catch (err) {
            if (!failure) failure = err as Error;
            stopped = true;
            abortAll();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, ranges.length) }, worker));
      if (failure) throw failure;
      if (stopped) throw new Error(UPLOAD_CANCELLED);

      const done = await completeFile(id, etags.map((etag, i) => ({ partNumber: i + 1, etag })));
      if (stopped) throw new Error(UPLOAD_CANCELLED); // cancelled while completing
      return done;
    } catch (err) {
      if (id) await deleteFile(id).catch(() => undefined);
      throw err;
    }
  };

  return {
    promise: run(),
    cancel: () => {
      stopped = true;
      abortAll();
    }
  };
}

// Public (signed-out) download endpoints: plain fetch, no auth header.
function publicError(status: number, serverMessage: string | undefined): string {
  if (status === 403) return "Wrong password";
  if (status === 404) return "File not found or deleted";
  if (status === 423) return "Too many wrong passwords; this file is locked";
  return serverMessage ?? `Request failed (${status})`;
}

async function parsePublic<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) throw new Error(publicError(resp.status, (data as { error?: string }).error));
  return data;
}

export async function getPublicFile(id: string): Promise<PublicFile> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  return parsePublic<PublicFile>(await fetch(`${base}/tools/f/${encodeURIComponent(id)}`));
}

export async function downloadPublicFile(id: string, password?: string): Promise<FileDownload> {
  const base = getApiBaseUrl();
  if (!base) throw new Error("API not configured");
  const resp = await fetch(`${base}/tools/f/${encodeURIComponent(id)}/download`, jsonInit("POST", password ? { password } : {}));
  return parsePublic<FileDownload>(resp);
}
