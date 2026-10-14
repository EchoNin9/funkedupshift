import { fetchWithAuth, getImpersonationHeaders } from "../utils/api";

/* Per-user preferences (pins, themeId, mode) live on the profile: GET/PUT /profile.
   Writes are coalesced (last write wins) and skipped while impersonating, because PUT /profile
   acts on the *effective* (impersonated) user and must never receive the admin's preferences. */

export interface ProfilePrefs {
  pins: string[];
  themeId: string;
  mode: string;
}
export type PrefsPatch = Partial<ProfilePrefs>;
export type SaveResult = "ok" | "failed" | "skipped";

const DEBOUNCE_MS = 400;

let syncUserId: string | null = null;

/** Set by ThemeProvider: the signed-in user's id, or null for guests. */
export function setSyncUser(userId: string | null): void {
  syncUserId = userId;
}

export function isImpersonating(): boolean {
  return Object.keys(getImpersonationHeaders()).length > 0;
}

/** True when profile writes would land on the signed-in user's own profile. */
export function canSync(): boolean {
  return !!syncUserId && !isImpersonating();
}

function apiBase(): string | null {
  const raw = typeof window !== "undefined" ? ((window as any).API_BASE_URL as string | undefined) : undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

export async function fetchProfilePrefs(): Promise<ProfilePrefs | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const resp = await fetchWithAuth(`${base}/profile`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const p = data?.profile ?? {};
    return {
      pins: Array.isArray(p.pins) ? p.pins.filter((v: unknown): v is string => typeof v === "string") : [],
      themeId: typeof p.themeId === "string" ? p.themeId : "",
      mode: typeof p.mode === "string" ? p.mode : "",
    };
  } catch {
    return null;
  }
}

let pending: PrefsPatch = {};
let waiters: Array<(r: SaveResult) => void> = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<unknown> = Promise.resolve();

async function flush(owner: string | null): Promise<void> {
  timer = null;
  const body = pending;
  const resolvers = waiters;
  pending = {};
  waiters = [];
  const done = (r: SaveResult) => resolvers.forEach((w) => w(r));
  // Identity changed (sign-out / switch / impersonation started) since the write was queued: drop it.
  if (!canSync() || syncUserId !== owner) return done("skipped");
  const base = apiBase();
  if (!base) return done("skipped");
  // Strictly one PUT at a time so an older batch can never land after a newer one.
  const run = inFlight.then(async (): Promise<SaveResult> => {
    try {
      const resp = await fetchWithAuth(`${base}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return resp.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  });
  inFlight = run;
  done(await run);
}

/** Queue a profile write. Resolves once the (possibly merged) request has finished. */
export function saveProfilePrefs(patch: PrefsPatch): Promise<SaveResult> {
  if (!canSync()) return Promise.resolve("skipped");
  const owner = syncUserId;
  pending = { ...pending, ...patch };
  const result = new Promise<SaveResult>((resolve) => waiters.push(resolve));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(owner), DEBOUNCE_MS);
  return result;
}
