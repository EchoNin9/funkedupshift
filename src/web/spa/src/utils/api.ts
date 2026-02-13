/**
 * Get impersonation headers for API requests.
 * Reads from sessionStorage so it can be used outside React context.
 */
export function getImpersonationHeaders(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem("funkedupshift_impersonation");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { type?: string; id?: string };
    if (parsed?.type === "user" && parsed?.id) return { "X-Impersonate-User": parsed.id };
    if (parsed?.type === "role" && parsed?.id) return { "X-Impersonate-Role": parsed.id };
  } catch {}
  return {};
}

/**
 * Fetch with auth token and impersonation headers.
 * Use this for API calls that should respect impersonation.
 */
export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const w = window as any;
  if (!w.auth?.getAccessToken) throw new Error("Not signed in");
  const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
    Authorization: `Bearer ${token}`,
    ...getImpersonationHeaders()
  };
  return fetch(url, { ...options, headers });
}
