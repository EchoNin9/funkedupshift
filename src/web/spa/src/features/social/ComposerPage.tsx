import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  PaperClipIcon,
  PencilSquareIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { Alert, FormField, SearchableSelect, type SelectOption } from "../../components";
import {
  ApiError,
  createPost,
  listAccounts,
  presignMedia,
  uploadFileToS3,
  type SocialAccount,
} from "./api";
import { countGraphemes, PLATFORM_RULES, validateForPlatform } from "./validation";
import { formatUtcLabel, localInputToUtcIso } from "./dateUtils";

interface MediaItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "error";
  progress: number;
  key?: string;
  error?: string;
}

const inputClass =
  "rounded-lg border border-border-hover bg-surface-0 px-3 py-2 text-sm text-text-primary w-full";
const textareaClass = `${inputClass} min-h-[6rem] resize-y`;

function accountKey(platform: string, accountId: string): string {
  return `${platform}:${accountId}`;
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function ComposerPage() {
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [overridesEnabled, setOverridesEnabled] = useState(false);
  const [overrideText, setOverrideText] = useState<Record<string, string>>({});
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [links, setLinks] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");

  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const list = await listAccounts();
      setAccounts(list);
    } catch (err) {
      setAccountsError(err instanceof Error ? err.message : "Could not load accounts.");
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accountOptions: SelectOption[] = useMemo(
    () =>
      accounts.map((a) => ({
        id: accountKey(a.platform, a.accountId),
        label: `${a.platform} · @${a.handle}`,
      })),
    [accounts]
  );

  const accountByKey = useMemo(() => {
    const map = new Map<string, SocialAccount>();
    for (const a of accounts) map.set(accountKey(a.platform, a.accountId), a);
    return map;
  }, [accounts]);

  const resolvedTextFor = useCallback(
    (key: string) => {
      if (overridesEnabled) {
        const override = overrideText[key];
        if (override && override.trim()) return override;
      }
      return text;
    },
    [overridesEnabled, overrideText, text]
  );

  const utcIso = useMemo(() => localInputToUtcIso(scheduledLocal), [scheduledLocal]);
  const isPast = !!utcIso && Date.parse(utcIso) <= Date.now();

  const updateMediaItem = useCallback((id: string, patch: Partial<MediaItem>) => {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const startUpload = useCallback(
    async (item: MediaItem) => {
      updateMediaItem(item.id, { status: "uploading", progress: 0, error: undefined });
      try {
        const presign = await presignMedia({
          filename: item.file.name,
          contentType: item.file.type,
          sizeBytes: item.file.size,
        });
        await uploadFileToS3(presign.uploadUrl, item.file, item.file.type, (fraction) =>
          updateMediaItem(item.id, { progress: Math.round(fraction * 100) })
        );
        updateMediaItem(item.id, { status: "uploaded", key: presign.key, progress: 100 });
      } catch (err) {
        updateMediaItem(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    },
    [updateMediaItem]
  );

  const handleFilesPicked = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const items: MediaItem[] = Array.from(files).map((file) => ({
        id: makeId(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        progress: 0,
      }));
      setMedia((prev) => [...prev, ...items]);
      items.forEach((item) => startUpload(item));
      // Reset so picking the same file again still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [startUpload]
  );

  const removeMedia = useCallback((id: string) => {
    setMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((m) => m.id !== id);
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitError(null);

      const errors: string[] = [];
      if (selectedKeys.length === 0) errors.push("Select at least one account to post to.");
      if (!utcIso) errors.push("Pick a valid scheduled date and time.");
      if (media.some((m) => m.status === "uploading")) errors.push("Wait for media uploads to finish.");
      if (media.some((m) => m.status === "error")) errors.push("Remove or retry failed media uploads.");

      const uploadedMedia = media
        .filter((m) => m.status === "uploaded")
        .map((m) => ({ name: m.file.name, type: m.file.type, size: m.file.size }));

      const perAccount: Record<string, string[]> = {};
      for (const key of selectedKeys) {
        const [platform] = key.split(":");
        const accErrors = validateForPlatform(platform, { text: resolvedTextFor(key), media: uploadedMedia });
        if (accErrors.length) perAccount[key] = accErrors;
      }

      setGeneralErrors(errors);
      setFieldErrors(perAccount);
      if (errors.length > 0 || Object.keys(perAccount).length > 0) return;

      if (isPast) {
        const proceed = window.confirm(
          "The scheduled time is in the past — the post will publish immediately. Continue?"
        );
        if (!proceed) return;
      }

      setSubmitting(true);
      try {
        const accountsPayload = selectedKeys.map((key) => {
          const [platform, accountId] = key.split(":");
          const override = overridesEnabled ? overrideText[key]?.trim() : "";
          return {
            platform,
            accountId,
            overrides: override ? { text: override } : {},
          };
        });
        const linkList = links
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const mediaKeys = media.filter((m) => m.status === "uploaded").map((m) => m.key!);

        await createPost({
          text,
          scheduledAt: utcIso!,
          accounts: accountsPayload,
          mediaKeys,
          links: linkList,
        });
        navigate("/social");
      } catch (err) {
        if (err instanceof ApiError && err.errors && err.errors.length) {
          setSubmitError(err.errors.join(" "));
        } else {
          setSubmitError(err instanceof Error ? err.message : "Could not create post.");
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      selectedKeys,
      utcIso,
      media,
      resolvedTextFor,
      isPast,
      overridesEnabled,
      overrideText,
      links,
      text,
      navigate,
    ]
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <motion.h1
        className="text-2xl font-semibold tracking-tight text-text-primary flex items-center gap-2"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <PencilSquareIcon className="h-6 w-6 text-accent" />
        New Social Post
      </motion.h1>

      {submitError && <Alert variant="error">{submitError}</Alert>}
      {generalErrors.length > 0 && (
        <Alert variant="error">
          <ul className="list-disc pl-4 space-y-0.5">
            {generalErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <FormField label="Post text" htmlFor="social-text" required>
          <textarea
            id="social-text"
            className={textareaClass}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's happening?"
          />
        </FormField>

        <FormField label="Accounts" required>
          {accountsError && <Alert variant="error" className="mb-2">{accountsError}</Alert>}
          {accountsLoading ? (
            <p className="text-sm text-text-tertiary">Loading accounts…</p>
          ) : accountOptions.length === 0 && !accountsError ? (
            <p className="text-sm text-text-tertiary">No connected accounts.</p>
          ) : (
            <SearchableSelect
              options={accountOptions}
              selected={selectedKeys}
              onChange={setSelectedKeys}
              placeholder="Search accounts…"
            />
          )}
        </FormField>

        {selectedKeys.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary">Character count</h3>
            <ul className="space-y-1">
              {selectedKeys.map((key) => {
                const account = accountByKey.get(key);
                const platform = key.split(":")[0];
                const rules = PLATFORM_RULES[platform];
                const resolved = resolvedTextFor(key);
                const count = countGraphemes(resolved);
                const max = rules?.maxGraphemes ?? Infinity;
                const ratio = max === Infinity ? 0 : count / max;
                const color = count > max ? "text-red-400" : ratio > 0.9 ? "text-amber-400" : "text-text-tertiary";
                return (
                  <li key={key} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary truncate">
                      {rules?.label ?? platform} · @{account?.handle ?? key}
                    </span>
                    <span className={color}>
                      {count}
                      {max !== Infinity ? ` / ${max}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            {Object.entries(fieldErrors).map(([key, errs]) =>
              errs.length ? (
                <Alert key={key} variant="error" className="mt-1">
                  <span className="font-medium">{accountByKey.get(key)?.handle ?? key}: </span>
                  {errs.join(" ")}
                </Alert>
              ) : null
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-text-secondary select-none cursor-pointer">
            <input
              type="checkbox"
              checked={overridesEnabled}
              onChange={(e) => setOverridesEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border-hover"
            />
            Customize text per account
          </label>
          {overridesEnabled && (
            <div className="space-y-3 pl-1">
              {selectedKeys.length === 0 && (
                <p className="text-xs text-text-tertiary">Select accounts above to customize their text.</p>
              )}
              {selectedKeys.map((key) => {
                const account = accountByKey.get(key);
                return (
                  <FormField key={key} label={`Override — ${account?.handle ?? key}`} htmlFor={`override-${key}`}>
                    <textarea
                      id={`override-${key}`}
                      className={textareaClass}
                      value={overrideText[key] ?? ""}
                      onChange={(e) => setOverrideText((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder="Leave blank to use the post text above"
                    />
                  </FormField>
                );
              })}
            </div>
          )}
        </div>

        <FormField label="Media">
          {/* Always mounted — a conditionally-rendered file input based on state the
              async upload handler itself sets can silently no-op the first pick
              (see CLAUDE.md gotcha #4). Hidden via CSS instead. */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFilesPicked(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-hover bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3 transition-colors"
          >
            <ArrowUpTrayIcon className="h-3.5 w-3.5" />
            Add images
          </button>

          {media.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {media.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-1 p-2"
                >
                  <img
                    src={m.previewUrl}
                    alt={m.file.name}
                    className="h-10 w-10 shrink-0 rounded object-cover border border-border-subtle"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-text-primary">{m.file.name}</p>
                    {m.status === "uploading" && (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full bg-accent-500 transition-[width]"
                          style={{ width: `${m.progress}%` }}
                        />
                      </div>
                    )}
                    {m.status === "uploaded" && <p className="text-xs text-emerald-400">Uploaded</p>}
                    {m.status === "error" && <p className="text-xs text-red-400 break-words">{m.error}</p>}
                  </div>
                  {m.status === "error" && (
                    <button
                      type="button"
                      onClick={() => startUpload(m)}
                      aria-label="Retry upload"
                      className="shrink-0 rounded-md p-1 text-text-tertiary hover:bg-surface-3 hover:text-text-primary transition-colors"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(m.id)}
                    aria-label="Remove image"
                    className="shrink-0 rounded-md p-1 text-text-tertiary hover:bg-surface-3 hover:text-red-400 transition-colors"
                  >
                    <XCircleIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormField>

        <FormField label="Links" htmlFor="social-links">
          <input
            id="social-links"
            type="text"
            className={inputClass}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder="Comma-separated URLs (optional)"
          />
          <p className="mt-1 flex items-center gap-1 text-xs text-text-tertiary">
            <PaperClipIcon className="h-3 w-3" /> Attached as link cards where the platform supports it.
          </p>
        </FormField>

        <FormField label="Scheduled time (your local time)" htmlFor="social-schedule" required>
          <input
            id="social-schedule"
            type="datetime-local"
            className={inputClass}
            value={scheduledLocal}
            onChange={(e) => setScheduledLocal(e.target.value)}
          />
          <p className="mt-1 text-xs text-text-tertiary">
            {utcIso ? `Resolves to ${formatUtcLabel(utcIso)}` : "Pick a date and time."}
          </p>
          {isPast && (
            <Alert variant="error" className="mt-2">
              This time is in the past — the post will publish immediately once submitted.
            </Alert>
          )}
        </FormField>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Scheduling…" : "Schedule post"}
          </button>
        </div>
      </form>
    </div>
  );
}
