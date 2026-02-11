import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../shell/AuthContext";

const ROLE_DISPLAY: Record<string, string> = {
  admin: "SuperAdmin",
  manager: "Manager",
  user: "User"
};

const TZ_OPTIONS = [
  { value: -8, label: "UTC-8" },
  { value: -5, label: "UTC-5" },
  { value: 0, label: "UTC+0/GMT" }
];

const TZ_STORAGE_KEY = "funkedupshift_lastlogin_tz";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

function getStoredTz(): number {
  try {
    const v = parseInt(sessionStorage.getItem(TZ_STORAGE_KEY) ?? "", 10);
    if (!isNaN(v) && TZ_OPTIONS.some((o) => o.value === v)) return v;
  } catch {}
  return -8;
}

function setStoredTz(val: number) {
  try {
    sessionStorage.setItem(TZ_STORAGE_KEY, String(val));
  } catch {}
}

function formatLastLogin(isoString: string | undefined, offsetHours: number, ip: string | undefined): string {
  if (!isoString) return ip ? `from ${ip}` : "—";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const t = d.getTime() + offsetHours * 3600000;
    const disp = new Date(t);
    const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
    const y = disp.getUTCFullYear();
    const m = pad(disp.getUTCMonth() + 1);
    const day = pad(disp.getUTCDate());
    const h = pad(disp.getUTCHours());
    const min = pad(disp.getUTCMinutes());
    const opt = TZ_OPTIONS.find((o) => o.value === offsetHours);
    const label = opt ? opt.label : offsetHours < 0 ? `UTC${offsetHours}` : `UTC+${offsetHours}`;
    let text = `${y}-${m}-${day} ${h}:${min} ${label}`;
    if (ip) text += ` from ${ip}`;
    return text;
  } catch {
    return isoString;
  }
}

interface ProfileData {
  userId?: string;
  email?: string;
  status?: string;
  cognitoGroups?: string[];
  customGroups?: string[];
  profile?: {
    description?: string;
    avatarUrl?: string;
    avatarKey?: string;
    lastLoginAt?: string;
    lastLoginIp?: string;
  };
}

const ProfilePage: React.FC = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [description, setDescription] = useState("");
  const [timezoneOffset, setTimezoneOffset] = useState(getStoredTz);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const apiBase = getApiBaseUrl();

  const fetchWithAuth = async (url: string, options?: RequestInit) => {
    const w = window as any;
    if (!w.auth?.getAccessToken) throw new Error("Not signed in");
    const token: string | null = await new Promise((r) => w.auth.getAccessToken(r));
    const headers = { ...options?.headers, Authorization: `Bearer ${token}` };
    return fetch(url, { ...options, headers });
  };

  useEffect(() => {
    if (!user || !apiBase) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    fetchWithAuth(`${apiBase}/profile`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || "Failed")));
        return r.json();
      })
      .then((data: ProfileData) => {
        if (cancelled) return;
        setProfile(data);
        setDescription(data.profile?.description ?? "");
      })
      .catch((e) => {
        if (!cancelled) setMessage({ text: `Failed to load profile: ${e?.message ?? "Unknown"}`, error: true });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, apiBase]);

  const handleSave = async () => {
    if (!apiBase) return;
    setIsSaving(true);
    setMessage(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim().slice(0, 100) })
      });
      if (!resp.ok) {
        const d = await resp.json();
        throw new Error(d.error || "Failed");
      }
      setMessage({ text: "Saved.", error: false });
    } catch (e: any) {
      setMessage({ text: `Error: ${e?.message ?? "Unknown"}`, error: true });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !apiBase) return;
    setAvatarError(null);
    if (!file.type?.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
      setAvatarError("Please choose PNG, JPEG, GIF, or WebP.");
      return;
    }
    const contentType = file.type || "image/png";
    try {
      const uploadResp = await fetchWithAuth(`${apiBase}/profile/avatar-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType })
      });
      if (!uploadResp.ok) {
        const d = await uploadResp.json();
        throw new Error(d.error || "Upload failed");
      }
      const { uploadUrl, key } = (await uploadResp.json()) as { uploadUrl: string; key: string };
      const putResp = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": contentType }
      });
      if (!putResp.ok) throw new Error("Upload failed");
      const updateResp = await fetchWithAuth(`${apiBase}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarKey: key })
      });
      if (!updateResp.ok) {
        const d = await updateResp.json();
        throw new Error(d.error || "Failed");
      }
      const fresh = await fetchWithAuth(`${apiBase}/profile`).then((r) => r.json());
      setProfile(fresh);
    } catch (e: any) {
      setAvatarError(`Error: ${e?.message ?? "Unknown"}`);
    }
  };

  const handleAvatarDelete = async () => {
    if (!apiBase) return;
    setAvatarError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/profile/avatar`, { method: "DELETE" });
      if (!resp.ok) {
        const d = await resp.json();
        throw new Error(d.error || "Failed");
      }
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              profile: { ...prev.profile, avatarUrl: undefined, avatarKey: undefined }
            }
          : null
      );
    } catch (e: any) {
      setAvatarError(`Error: ${e?.message ?? "Unknown"}`);
    }
  };

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">My Profile</h1>
        <p className="text-sm text-slate-400">
          <Link to="/auth" className="text-brand-orange hover:underline">
            Sign in
          </Link>{" "}
          to view and edit your profile.
        </p>
      </div>
    );
  }

  if (!apiBase) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">My Profile</h1>
        <p className="text-sm text-red-400">API URL not set.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">My Profile</h1>
        <p className="text-sm text-slate-400">Loading profile…</p>
      </div>
    );
  }

  const lastLoginText = profile?.profile
    ? formatLastLogin(profile.profile.lastLoginAt, timezoneOffset, profile.profile.lastLoginIp)
    : "—";

  return (
    <div className="space-y-6 max-w-2xl">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200">
        ← Back to Home
      </Link>

      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">My Profile</h1>
      </header>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-400">Last login timezone</label>
        <select
          value={timezoneOffset}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setStoredTz(v);
            setTimezoneOffset(v);
          }}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
        >
          {TZ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            message.error ? "border-red-500/60 bg-red-500/10 text-red-200" : "border-green-500/40 bg-green-500/10 text-green-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {profile && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">User info</h2>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-1 pr-4 font-medium text-slate-300 w-28">Email</td>
                  <td className="text-slate-400">{profile.email ?? "—"}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 font-medium text-slate-300">Status</td>
                  <td className="text-slate-400">{profile.status ?? "—"}</td>
                </tr>
                <tr>
                  <td className="py-1 pr-4 font-medium text-slate-300">Last login</td>
                  <td className="text-slate-400">{lastLoginText}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">System role</h2>
            <div className="flex flex-wrap gap-2">
              {(profile.cognitoGroups?.length ?? 0) > 0 ? (
                profile.cognitoGroups!.map((g) => {
                  const display = ROLE_DISPLAY[g] ?? g;
                  const cls =
                    g === "admin" ? "bg-amber-500/20 text-amber-300" : g === "manager" ? "bg-blue-500/20 text-blue-300" : "bg-slate-700 text-slate-200";
                  return (
                    <span key={g} className={`rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
                      {display}
                    </span>
                  );
                })
              ) : (
                <span className="rounded-md px-2 py-0.5 text-xs font-medium bg-slate-700 text-slate-200">User</span>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Custom groups</h2>
            {(profile.customGroups?.length ?? 0) > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.customGroups!.map((g) => (
                  <span key={g} className="rounded-md px-2 py-0.5 text-xs font-medium bg-emerald-500/20 text-emerald-300">
                    {g}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Not in any custom groups.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-3">Edit profile</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Profile icon</label>
                <div className="flex items-start gap-4">
                  {profile.profile?.avatarUrl ? (
                    <img
                      src={profile.profile.avatarUrl}
                      alt="Profile"
                      className="h-24 w-24 rounded-full border-2 border-slate-700 object-cover"
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-full border-2 border-slate-700 bg-slate-800 flex items-center justify-center text-2xl text-slate-500">
                      ?
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={handleAvatarChange}
                      className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-slate-100"
                    />
                    {profile.profile?.avatarUrl && (
                      <button
                        type="button"
                        onClick={handleAvatarDelete}
                        className="self-start rounded-md border border-red-500/60 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20"
                      >
                        Remove icon
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">PNG, JPEG, GIF, or WebP. Same constraints as thumbnail uploads.</p>
                {avatarError && <p className="mt-1 text-xs text-red-400">{avatarError}</p>}
              </div>

              <div>
                <label htmlFor="profile-description" className="block text-xs font-medium text-slate-400 mb-1">
                  Description
                </label>
                <textarea
                  id="profile-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={100}
                  placeholder="About you (max 100 characters)"
                  rows={4}
                  className="w-full max-w-md rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                />
                <div className={`mt-1 text-xs ${description.length >= 100 ? "text-red-400" : "text-slate-500"}`}>
                  {description.length} / 100
                </div>
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-500 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
