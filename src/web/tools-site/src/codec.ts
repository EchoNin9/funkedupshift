// Pure encode/decode helpers (Base64, JWT, relative time). Browser built-ins only.
// Duplicated byte-for-byte in the SPA's src/features/encode/codec.ts — the two
// apps never import from each other, so keep both copies identical.

export function bytesToBase64(bytes: Uint8Array, urlSafe: boolean): string {
  let bin = "";
  // chunked so a multi-MB input doesn't blow the argument limit of apply()
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  const out = btoa(bin);
  return urlSafe ? out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : out;
}

/** Accepts either alphabet, padded or not, ignoring whitespace. Throws on invalid input. */
export function base64ToBytes(input: string): Uint8Array {
  const s = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error("Not valid Base64: contains characters outside the Base64 alphabet.");
  const body = s.replace(/=+$/, "");
  if (body.length % 4 === 1) throw new Error("Not valid Base64: the length is impossible (truncated input?).");
  const bin = atob(body + "=".repeat((4 - (body.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function encodeBase64Text(text: string, urlSafe: boolean): string {
  return bytesToBase64(new TextEncoder().encode(text), urlSafe);
}

export function decodeBase64Text(input: string): string {
  const bytes = base64ToBytes(input);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Decoded bytes are not valid UTF-8 text (this may be binary data).");
  }
}

export function decodeUrlText(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    throw new Error("Invalid percent-encoding: found a malformed %XX sequence.");
  }
}

// ---- JWT ----

export interface JwtTime {
  claim: string;
  local: string;
  utc: string;
}

export interface JwtParsed {
  header: string;
  payload: string;
  signature: string;
  times: JwtTime[];
  status: string | null;
}

function decodeJwtPart(raw: string, name: string): unknown {
  let text: string;
  try {
    text = decodeBase64Text(raw);
  } catch (e) {
    throw new Error(`The ${name} is not valid Base64URL: ${e instanceof Error ? e.message : "decode failed"}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The ${name} decoded, but is not valid JSON.`);
  }
}

/** "3 hours", "2 days", ... for a non-negative number of seconds. */
export function formatRelative(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const units: [string, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [name, size] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? "" : "s"}`;
    }
  }
  return `${s} second${s === 1 ? "" : "s"}`;
}

export function parseJwt(input: string, nowMs: number = Date.now()): JwtParsed {
  const token = input.trim().replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(`A JWT has 3 dot-separated parts (header.payload.signature); found ${parts.length}.`);
  }
  const header = decodeJwtPart(parts[0], "header");
  const payload = decodeJwtPart(parts[1], "payload");

  const claims = payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const times: JwtTime[] = [];
  for (const claim of ["exp", "iat", "nbf"]) {
    const v = claims[claim];
    if (typeof v === "number" && Number.isFinite(v)) {
      const d = new Date(v * 1000);
      if (!Number.isNaN(d.getTime())) times.push({ claim, local: d.toLocaleString(), utc: d.toISOString() });
    }
  }

  const nowS = nowMs / 1000;
  const exp = claims.exp;
  const nbf = claims.nbf;
  let status: string | null = null;
  if (typeof exp === "number" && exp < nowS) status = `Expired ${formatRelative(nowS - exp)} ago`;
  else if (typeof nbf === "number" && nbf > nowS) status = "Not yet valid";
  else if (typeof exp === "number") status = `Valid for ${formatRelative(exp - nowS)}`;
  else if (exp === undefined) status = "No expiry";

  return {
    header: JSON.stringify(header, null, 2),
    payload: JSON.stringify(payload, null, 2),
    signature: parts[2],
    times,
    status,
  };
}
