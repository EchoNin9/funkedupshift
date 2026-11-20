import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Key, Trash } from "@phosphor-icons/react";
import { Alert } from "../../components/Alert";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
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
import { FeedModal } from "./FeedModal";
import { useFeedsContext } from "./FeedsLayout";

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

function isAuthExpired(err: unknown): boolean {
  return (err as { name?: string } | null | undefined)?.name === "AuthExpiredError";
}

export const FeedsSettingsView: React.FC = () => {
  const { userTz, handleTimezoneUpdated, handleAuthError } = useFeedsContext();

  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [keyName, setKeyName] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyMeta | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [tzInput, setTzInput] = useState(userTz);
  const [savingTz, setSavingTz] = useState(false);
  const [tzNotice, setTzNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tzSelectId = useId();
  const keyLabelId = useId();
  const mountedRef = useRef(true);
  const userTzRef = useRef(userTz);
  userTzRef.current = userTz;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      if (!mountedRef.current) return;
      setKeys(res.keys);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to load API keys.");
    } finally {
      if (mountedRef.current) setKeysLoading(false);
    }
  }, [handleAuthError]);

  useEffect(() => {
    let cancelled = false;
    void loadKeys();
    void getPrefs()
      .then((prefs) => {
        if (!cancelled && prefs.tz) {
          setTzInput(prefs.tz);
          if (prefs.tz !== userTzRef.current) {
            handleTimezoneUpdated(prefs.tz);
          }
        }
      })
      .catch(() => {
        // Non-fatal fallback to userTz from FeedsContext
      });
    return () => {
      cancelled = true;
    };
  }, [loadKeys, handleTimezoneUpdated]);

  const handleSaveTz: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setSavingTz(true);
    setTzNotice(null);
    setError(null);
    try {
      const res = await updatePrefs(tzInput);
      if (!mountedRef.current) return;
      handleTimezoneUpdated(res.tz);
      setTzNotice(`Timezone saved (${res.tz}).`);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setError((err as { message?: string })?.message || "Failed to update timezone.");
    } finally {
      if (mountedRef.current) setSavingTz(false);
    }
  };

  const handleCreateKey: React.FormEventHandler = async (e) => {
    e.preventDefault();
    const trimmed = keyName.trim();
    if (!trimmed) {
      setKeyError("Key name cannot be blank.");
      return;
    }
    setCreatingKey(true);
    setKeyError(null);
    setError(null);
    setNewRawKey(null);
    try {
      const res = await createKey(trimmed);
      if (!mountedRef.current) return;
      setNewRawKey(res.rawKey);
      setKeyName("");
      setKeys((prev) => [res.key, ...prev]);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      if (isAuthExpired(err)) {
        handleAuthError();
        return;
      }
      setKeyError((err as { message?: string })?.message || "Failed to create API key.");
    } finally {
      if (mountedRef.current) setCreatingKey(false);
    }
  };

  const apiBase = getApiBaseUrl() || "https://YOUR_API_BASE_URL";
  const curlSnippet = newRawKey
    ? `curl -sS -X POST "${apiBase}/feeds/ingest" \\\n  -H "X-Api-Key: ${newRawKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"feed":"mox-todoist","title":"Mox · Todoist","items":[{"guid":"todoist-2026-11-19","title":"Todoist Summary","contentMarkdown":"*Today*\\n• <https://todoist.com|Check tasks>"}]}'`
    : "";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-text-primary sm:text-2xl">
          Settings
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Day-bucketing timezone and ingest API keys.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <section
        className="space-y-3 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 sm:p-5"
        aria-labelledby="feeds-pref-timezone"
      >
        <div>
          <h3
            id="feeds-pref-timezone"
            className="font-display text-base font-semibold text-text-primary"
          >
            Archive timezone
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Feed items and Mox daily summaries are grouped into calendar days using this timezone.
          </p>
        </div>

        <form className="flex flex-col gap-2.5 sm:flex-row sm:items-center" onSubmit={handleSaveTz}>
          <label htmlFor={tzSelectId} className="sr-only">
            Archive timezone
          </label>
          <select
            id={tzSelectId}
            aria-label="Archive timezone"
            value={tzInput}
            onChange={(e) => setTzInput(e.target.value)}
            disabled={savingTz}
            className="input sm:max-w-xs"
          >
            {tzOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={`${buttonClasses("primary", "md")} shrink-0`}
            disabled={savingTz}
          >
            {savingTz ? "Saving…" : "Save timezone"}
          </button>
        </form>

        {tzNotice && <Alert variant="success">{tzNotice}</Alert>}
      </section>

      <section
        className="space-y-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-4 sm:p-5"
        aria-labelledby="feeds-pref-keys"
      >
        <div>
          <h3
            id="feeds-pref-keys"
            className="font-display text-base font-semibold text-text-primary"
          >
            Ingest API keys (Mox / qwer / Rally)
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Each key grants{" "}
            <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs text-text-primary">
              POST /feeds/ingest
            </code>{" "}
            write access to your push feeds. Raw keys are shown once at creation.
          </p>
        </div>

        <form className="flex flex-col gap-2.5 sm:flex-row sm:items-center" onSubmit={handleCreateKey}>
          <label className="sr-only" htmlFor={keyLabelId}>
            API key label
          </label>
          <input
            id={keyLabelId}
            type="text"
            maxLength={80}
            placeholder="Key label (e.g. openclaw-mox)"
            value={keyName}
            onChange={(e) => {
              setKeyName(e.target.value);
              if (keyError) setKeyError(null);
            }}
            disabled={creatingKey}
            className="input sm:max-w-xs"
            required
          />
          <button
            type="submit"
            className={`${buttonClasses("primary", "md")} shrink-0`}
            disabled={creatingKey}
          >
            <Key size={15} weight="bold" aria-hidden="true" />
            <span>{creatingKey ? "Creating…" : "Create API key"}</span>
          </button>
        </form>

        {keyError && <Alert variant="error">{keyError}</Alert>}

        {newRawKey && (
          <div
            className="space-y-3 rounded-ds-md border border-accent/45 bg-accent/10 p-3.5"
            role="status"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-semibold text-text-primary">
                Copy your new API key now — it will not be shown again:
              </strong>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={newRawKey} label="Copy key" variant="primary" size="sm" />
                <button
                  type="button"
                  className={buttonClasses("secondary", "sm")}
                  onClick={() => setNewRawKey(null)}
                >
                  I&apos;ve saved this key
                </button>
              </div>
            </div>

            <pre className="m-0 overflow-x-auto rounded-ds-sm border border-[color:var(--color-divider)] bg-surface-0 px-3 py-2 font-mono text-xs text-text-primary">
              {newRawKey}
            </pre>

            <details className="space-y-2 text-xs text-text-secondary">
              <summary className="cursor-pointer font-semibold text-text-primary hover:text-accent-text">
                Show sample OpenClaw / Mox curl command
              </summary>
              <div className="space-y-2 pt-1.5">
                <div className="flex justify-end">
                  <CopyButton text={curlSnippet} label="Copy curl" variant="secondary" size="sm" />
                </div>
                <pre className="m-0 overflow-x-auto rounded-ds-sm border border-[color:var(--color-divider)] bg-surface-0 px-3 py-2.5 font-mono text-xs leading-relaxed text-text-primary">
                  {curlSnippet}
                </pre>
              </div>
            </details>
          </div>
        )}

        {keysLoading ? (
          <div className="py-4 text-sm text-text-secondary" role="status">
            Loading API keys…
          </div>
        ) : keys.length === 0 ? (
          <p className="m-0 text-sm text-text-secondary">No API keys created yet.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--color-divider)] rounded-ds-md border border-[color:var(--color-divider)] bg-surface-1">
            {keys.map((k) => (
              <li
                key={k.keyId}
                className={`flex flex-wrap items-center justify-between gap-3 px-3.5 py-3 ${
                  k.revoked ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="min-w-0 [overflow-wrap:anywhere] text-sm font-semibold text-text-primary">
                      {k.name}
                    </strong>
                    <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                      {k.prefix}…
                    </code>
                    {k.revoked && (
                      <span className="inline-flex items-center rounded-full border border-[color:var(--color-divider)] bg-surface-3 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase text-text-tertiary">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
                    <span>Created {formatRelativeTime(k.createdAt)}</span>
                    <span>
                      Last used {k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : "Never"}
                    </span>
                  </div>
                </div>

                {!k.revoked && (
                  <button
                    type="button"
                    className={`inline-flex min-h-[32px] items-center gap-1 rounded-ds-sm border border-danger/35 bg-surface-2 px-2.5 py-1 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 ${focusRing}`}
                    onClick={() => {
                      setRevokeError(null);
                      setRevokeTarget(k);
                    }}
                  >
                    <Trash size={13} weight="regular" aria-hidden="true" />
                    <span>Revoke</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FeedModal
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
        <p className="m-0 text-sm text-text-secondary [overflow-wrap:anywhere]">
          Revoke <strong className="text-text-primary [overflow-wrap:anywhere]">{revokeTarget?.name}</strong> (
          <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs text-text-primary">
            {revokeTarget?.prefix}…
          </code>
          )? Any cron jobs using this key will immediately get 401 errors.
        </p>
        {revokeError && <Alert variant="error">{revokeError}</Alert>}
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClasses("secondary", "md")}
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
            className={`inline-flex items-center justify-center gap-2 rounded-ds-md bg-danger px-3.5 py-2 text-sm font-semibold text-on-danger transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`}
            onClick={async () => {
              if (!revokeTarget) return;
              const targetId = revokeTarget.keyId;
              setRevoking(true);
              setRevokeError(null);
              try {
                await revokeKey(targetId);
                if (!mountedRef.current) return;
                setKeys((prev) =>
                  prev.map((item) => (item.keyId === targetId ? { ...item, revoked: true } : item))
                );
                setRevokeTarget(null);
              } catch (err: unknown) {
                if (!mountedRef.current) return;
                if (isAuthExpired(err)) {
                  setRevokeTarget(null);
                  handleAuthError();
                  return;
                }
                setRevokeError(
                  (err as { message?: string })?.message || "Failed to revoke API key."
                );
              } finally {
                if (mountedRef.current) setRevoking(false);
              }
            }}
            disabled={revoking}
          >
            {revoking ? "Revoking…" : "Revoke key"}
          </button>
        </div>
      </FeedModal>
    </div>
  );
};

export default FeedsSettingsView;
