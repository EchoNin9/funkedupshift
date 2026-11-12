import { fetchWithAuth } from "../../utils/api";
import { partRanges, retryDelayMs } from "./filedrop";

export function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

async function parseJsonOrThrow<T>(resp: Response): Promise<T> {
  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${resp.status})`);
  }
  return data;
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
