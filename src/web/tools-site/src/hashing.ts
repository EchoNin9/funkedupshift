// Pure logic for the Hash & UUID tool. Duplicated verbatim in the tools site and the SPA; keep byte-identical.

// ponytail: files are capped at 1 GB. Web Crypto has no incremental digest, so the whole file is read into one
// buffer (chunked, awaiting between chunks so the UI stays responsive) and then digested; the MD5 pass below is
// a synchronous loop on the main thread, acceptable at this cap. If bigger files matter, switch to a streaming
// hash library (e.g. hash-wasm) that digests chunk by chunk.
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export type OutFormat = "hex" | "base64";
export interface HashResult {
  label: string;
  bytes: Uint8Array;
}

export const encodeUtf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const format = (b: Uint8Array, f: OutFormat): string => (f === "hex" ? toHex(b) : toBase64(b));

// ---- MD5 (RFC 1321). Not for security. ----
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

export function md5(data: Uint8Array): Uint8Array {
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const m = new Uint32Array(16);
  const block = (src: Uint8Array, off: number) => {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      m[i] = src[j] | (src[j + 1] << 8) | (src[j + 2] << 16) | (src[j + 3] << 24);
    }
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = (a + f + K[i] + m[g]) | 0;
      const s = S[(i >> 4) * 4 + (i & 3)];
      a = d; d = c; c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    state[0] = (state[0] + a) | 0; state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0; state[3] = (state[3] + d) | 0;
  };
  const full = data.length - (data.length % 64);
  for (let o = 0; o < full; o += 64) block(data, o);
  // Tail + padding in a small separate buffer (avoids copying a huge input).
  const rest = data.length - full;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(data.subarray(full));
  tail[rest] = 0x80;
  const dv = new DataView(tail.buffer);
  dv.setUint32(tail.length - 8, (data.length * 8) >>> 0, true);
  dv.setUint32(tail.length - 4, Math.floor(data.length / 0x20000000), true);
  for (let o = 0; o < tail.length; o += 64) block(tail, o);
  const out = new Uint8Array(16);
  state.forEach((v, i) => new DataView(out.buffer).setUint32(i * 4, v >>> 0, true));
  return out;
}

const SHA = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

export async function digestAll(data: Uint8Array): Promise<HashResult[]> {
  const out: HashResult[] = [];
  for (const alg of SHA) out.push({ label: alg, bytes: new Uint8Array(await crypto.subtle.digest(alg, data as BufferSource)) });
  out.push({ label: "MD5 (not for security)", bytes: md5(data) });
  return out;
}

export async function hmacSha256(message: string, key: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", encodeUtf8(key) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, encodeUtf8(message) as BufferSource));
}

/** Reads a file into one buffer via its stream, reporting 0-100 progress. Throws above the 1 GB cap. */
export async function readFileBytes(file: File, onProgress: (pct: number) => void): Promise<Uint8Array> {
  if (file.size > MAX_FILE_BYTES) throw new Error("File is too large: the limit is 1 GB.");
  const buf = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); // awaiting here yields to the UI between chunks
    if (done) break;
    buf.set(value, n);
    n += value.length;
    onProgress(file.size ? Math.floor((n / file.size) * 100) : 100);
  }
  return buf;
}

/** Returns the label of the first algorithm whose digest equals `expected`, or null. Hex is case-insensitive, Base64 exact. */
export function matchChecksum(expected: string, results: HashResult[]): string | null {
  const e = expected.trim();
  if (e === "") return null;
  const lower = e.toLowerCase();
  const hit = results.find((r) => toHex(r.bytes) === lower || toBase64(r.bytes) === e);
  return hit ? hit.label.replace(" (not for security)", "") : null;
}

// ---- UUID / ULID ----
const rand = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

export const uuidV4 = (): string => crypto.randomUUID();

/** RFC 9562 UUID v7: 48-bit big-endian Unix ms, version 7, variant 10, rest random. */
export function uuidV7(now: number = Date.now()): string {
  const b = rand(16);
  let t = now;
  for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 10 chars of 48-bit ms timestamp + 16 chars (80 bits) random, Crockford base32. */
export function ulid(now: number = Date.now()): string {
  let t = now;
  let ts = "";
  for (let i = 0; i < 10; i++) { ts = CROCKFORD[t % 32] + ts; t = Math.floor(t / 32); }
  return ts + Array.from(rand(16), (x) => CROCKFORD[x % 32]).join("");
}

export type GenKind = "uuid4" | "uuid7" | "ulid";
export const generate = (kind: GenKind, count: number): string[] => {
  const n = Math.min(100, Math.max(1, Math.floor(count) || 1));
  const fn = kind === "uuid4" ? uuidV4 : kind === "uuid7" ? uuidV7 : ulid;
  return Array.from({ length: n }, () => fn());
};
