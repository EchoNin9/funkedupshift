import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createKey,
  getApiBaseUrl,
  getPrefs,
  listKeys,
  revokeKey,
  updatePrefs,
  type ApiKeyMeta,
} from "./api";
import { formatRelativeTime } from "./dateFormat";
import Dialog from "./Dialog";
import type { ThemePreference } from "./theme";

interface SettingsViewProps {
  userEmail: string | null;
  userTz: string;
  themePref: ThemePreference;
  osDark: boolean;
  onChangeTheme: (pref: ThemePreference) => void;
  onTimezoneUpdated: (tz: string) => void;
  onSignOut: () => void;
  onAuthError: () => void;
}

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const SettingsView: React.FC<SettingsViewProps> = ({
  userEmail,
  userTz,
  themePref,
  osDark,
  onChangeTheme,
  onTimezoneUpdated,
  onSignOut,
  onAuthError,
}) => {
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyMeta | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [tzInput, setTzInput] = useState(userTz);
  const [savingTz, setSavingTz] = useState(false);
  const [tzNotice, setTzNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTzInput(userTz);
  }, [userTz]);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, []);

  const tzOptions = useMemo(() => {
    const set = new Set<string>(COMMON_TIMEZONES);
    if (browserTz) set.add(browserTz);
    if (userTz) set.add(userTz);
    return Array.from(set);
  }, [browserTz, userTz]);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await listKeys();
      setKeys(res.keys);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load API keys.");
    } finally {
      setKeysLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    let cancelled = false;
    void loadKeys();
    void getPrefs()
      .then((prefs) => {
        if (!cancelled && prefs.tz) {
          setTzInput(prefs.tz);
          if (prefs.tz !== userTz) onTimezoneUpdated(prefs.tz);
        }
      })
      .catch(() => {
        // Non-fatal fallback to userTz passed from App
      });
    return () => {
      cancelled = true;
    };
  }, [loadKeys]);

  const handleSaveTz: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setSavingTz(true);
    setTzNotice(null);
    setError(null);
    try {
      const res = await updatePrefs(tzInput);
      onTimezoneUpdated(res.tz);
      setTzNotice(`Timezone saved (${res.tz}).`);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to update timezone.");
    } finally {
      setSavingTz(false);
    }
  };

  const handleCreateKey: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const trimmed = keyName.trim();
    if (!trimmed) return;
    setCreatingKey(true);
    setError(null);
    setNewRawKey(null);
    setCopiedKey(false);
    try {
      const res = await createKey(trimmed);
      setNewRawKey(res.rawKey);
      setKeyName("");
      setKeys((prev) => [res.key, ...prev]);
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AuthExpiredError") {
        onAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to create API key.");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleCopyKey = async () => {
    if (!newRawKey) return;
    try {
      await navigator.clipboard.writeText(newRawKey);
      setCopiedKey(true);
    } catch {
      setCopiedKey(false);
    }
  };

  const apiBase = getApiBaseUrl() || "https://YOUR_API_BASE_URL";

  return (
    <div className="view-wrap">
      <header className="view-header">
        <div>
          <h1 className="view-title">Settings</h1>
          <p className="view-subtitle">Appearance, day-bucketing timezone, and ingest API keys.</p>
        </div>
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      <section className="settings-card" aria-labelledby="pref-appearance">
        <h2 id="pref-appearance" className="settings-heading">
          Appearance
        </h2>
        <p className="field-hint">
          Default follows your OS preference. Pin Light or Dark here when you want an override.
        </p>
        <div className="theme-radios" role="radiogroup" aria-label="Color theme">
          <label className="theme-radio-option">
            <input
              type="radio"
              name="theme-pref"
              checked={themePref === "system"}
              onChange={() => onChangeTheme("system")}
            />
            <span>System (currently {osDark ? "Dark" : "Light"})</span>
          </label>
          <label className="theme-radio-option">
            <input
              type="radio"
              name="theme-pref"
              checked={themePref === "light"}
              onChange={() => onChangeTheme("light")}
            />
            <span>Light</span>
          </label>
          <label className="theme-radio-option">
            <input
              type="radio"
              name="theme-pref"
              checked={themePref === "dark"}
              onChange={() => onChangeTheme("dark")}
            />
            <span>Dark</span>
          </label>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="pref-timezone">
        <h2 id="pref-timezone" className="settings-heading">
          Archive timezone
        </h2>
        <p className="field-hint">
          Feed items and Mox daily summaries are grouped into calendar days using this timezone.
        </p>
        <form className="inline-form" onSubmit={handleSaveTz}>
          <select
            aria-label="Archive timezone"
            value={tzInput}
            onChange={(e) => setTzInput(e.target.value)}
            disabled={savingTz}
          >
            {tzOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={savingTz}>
            {savingTz ? "Saving…" : "Save timezone"}
          </button>
        </form>
        {tzNotice && <p className="field-success">{tzNotice}</p>}
      </section>

      <section className="settings-card" aria-labelledby="pref-keys">
        <h2 id="pref-keys" className="settings-heading">
          Ingest API keys (Mox / qwer / Rally)
        </h2>
        <p className="field-hint">
          Each key grants <code>POST /feeds/ingest</code> write access to your push feeds. Raw keys
          are shown once at creation.
        </p>

        <form className="inline-form" onSubmit={handleCreateKey}>
          <label className="sr-only" htmlFor="api-key-label">
            API key label
          </label>
          <input
            id="api-key-label"
            type="text"
            maxLength={80}
            placeholder="Key label (e.g. openclaw-mox)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            disabled={creatingKey}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={creatingKey}>
            {creatingKey ? "Creating…" : "Create API key"}
          </button>
        </form>

        {newRawKey && (
          <div className="secret-box" role="status">
            <div className="secret-box-top">
              <strong>Copy your new API key now — it will not be shown again:</strong>
              <button type="button" className="btn btn-primary" onClick={() => void handleCopyKey()}>
                {copiedKey ? "Copied" : "Copy key"}
              </button>
            </div>
            <pre className="secret-value">{newRawKey}</pre>
            <details className="curl-example">
              <summary>Show sample curl command</summary>
              <pre>{`curl -sS -X POST "${apiBase}/feeds/ingest" \\
  -H "X-Api-Key: ${newRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"feed":"mox-todoist","title":"Mox · Todoist","items":[{"guid":"todoist-2026-11-19","title":"Todoist Summary","contentMarkdown":"*Today*\\n• <https://todoist.com|Check tasks>"}]}'`}</pre>
            </details>
          </div>
        )}

        {keysLoading ? (
          <div className="loading-state">Loading API keys…</div>
        ) : keys.length === 0 ? (
          <p className="field-hint">No API keys created yet.</p>
        ) : (
          <ul className="keys-list">
            {keys.map((k) => (
              <li key={k.keyId} className={k.revoked ? "key-row is-revoked" : "key-row"}>
                <div className="key-info">
                  <div className="feed-top">
                    <strong>{k.name}</strong>
                    <code className="key-prefix">{k.prefix}…</code>
                    {k.revoked && <span className="kind-badge">revoked</span>}
                  </div>
                  <div className="feed-meta">
                    <span>Created {formatRelativeTime(k.createdAt)}</span>
                    <span>Last used {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : "Never"}</span>
                  </div>
                </div>
                {!k.revoked && (
                  <button
                    type="button"
                    className="btn-chip btn-chip-danger"
                    onClick={() => {
                      setRevokeError(null);
                      setRevokeTarget(k);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="settings-card" aria-labelledby="pref-account">
        <h2 id="pref-account" className="settings-heading">
          Account
        </h2>
        <div className="account-row">
          <span>Signed in as <strong>{userEmail || "Cognito user"}</strong></span>
          <button type="button" className="btn btn-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>

      <Dialog
        open={revokeTarget !== null}
        onClose={() => {
          if (!revoking) {
            setRevokeError(null);
            setRevokeTarget(null);
          }
        }}
        title="Revoke API key?"
        closedBy={revoking ? "none" : "closerequest"}
      >
        <p className="confirm-copy">
          Revoke <strong>{revokeTarget?.name}</strong> (<code>{revokeTarget?.prefix}…</code>)? Any
          cron jobs using this key will immediately get 401 errors.
        </p>
        {revokeError && <div className="banner banner-error">{revokeError}</div>}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setRevokeError(null);
              setRevokeTarget(null);
            }}
            disabled={revoking}
            data-autofocus=""
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!revokeTarget) return;
              setRevoking(true);
              setRevokeError(null);
              try {
                await revokeKey(revokeTarget.keyId);
                setKeys((prev) =>
                  prev.map((item) =>
                    item.keyId === revokeTarget.keyId ? { ...item, revoked: true } : item
                  )
                );
                setRevokeTarget(null);
              } catch (err: unknown) {
                if ((err as { name?: string })?.name === "AuthExpiredError") {
                  setRevokeTarget(null);
                  onAuthError();
                  return;
                }
                setRevokeError((err as { message?: string })?.message || "Failed to revoke API key.");
              } finally {
                setRevoking(false);
              }
            }}
            disabled={revoking}
          >
            {revoking ? "Revoking…" : "Revoke key"}
          </button>
        </div>
      </Dialog>
    </div>
  );
};

export default SettingsView;
