import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle, LockSimple } from "@phosphor-icons/react";
import { Alert } from "../../components";
import { buttonClasses, focusRing } from "../../components/buttonClasses";
import { CopyButton } from "../../components/CopyButton";
import { FormCard } from "../../components/FormCard";
import { ListCard, ListEmpty, ListRow } from "../../components/ListCard";
import { useAuth } from "../../shell/AuthContext";
import {
  FILE_MAX_BYTES,
  FILE_TOO_LARGE_MESSAGE,
  FileExpiry,
  FileList,
  FileUpload,
  UPLOAD_CANCELLED,
  deleteFile,
  listFiles,
  startUpload,
} from "./api";
import { expiryLabel, formatBytes, shareUrlFor } from "./filedrop";

const input = `rounded-ds-md border border-border-default bg-surface-0 px-3 text-[15px] text-text-primary placeholder:text-text-tertiary hover:border-border-hover motion-safe:transition-colors motion-safe:duration-150 ${focusRing}`;

const EXPIRY_OPTIONS: { value: FileExpiry; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const FilesPage: React.FC = () => {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expiry, setExpiry] = useState<FileExpiry>("1d");
  const [password, setPassword] = useState("");
  const [oneTime, setOneTime] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [data, setData] = useState<FileList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const upload = useRef<FileUpload | null>(null);

  const load = useCallback(async () => {
    setListError(null);
    try {
      setData(await listFiles());
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load your files.");
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Prompt before closing the tab mid-upload.
  useEffect(() => {
    if (!uploading) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [uploading]);

  // Navigating away mid-upload cancels it (and deletes the partial upload).
  useEffect(() => () => upload.current?.cancel(), []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setResultId(null);
    setError(f.size > FILE_MAX_BYTES ? FILE_TOO_LARGE_MESSAGE : null);
    setFile(f.size > FILE_MAX_BYTES ? null : f);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    setResultId(null);
    setProgress({ loaded: 0, total: file.size });
    const up = startUpload(file, { expiry, password: password || undefined, oneTime }, (loaded, total) =>
      setProgress({ loaded, total })
    );
    upload.current = up;
    try {
      const done = await up.promise;
      setResultId(done.id);
      setFile(null);
      setPassword("");
      setOneTime(false);
    } catch (err) {
      if (!(err instanceof Error && err.message === UPLOAD_CANCELLED)) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    } finally {
      upload.current = null;
      setUploading(false);
      load();
    }
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    try {
      await deleteFile(id);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to delete file.");
    }
    load();
  };

  const pct = progress.total ? Math.floor((progress.loaded / progress.total) * 100) : 0;
  const srTitle = <h1 className="sr-only">File Drop</h1>;

  if (!user) {
    return (
      <div className="space-y-4">
        {srTitle}
        <div className="flex flex-wrap items-center gap-4 rounded-ds-lg border border-[color:var(--color-divider)] bg-surface-2 p-6">
          <LockSimple size={26} weight="regular" aria-hidden="true" className="text-accent-text" />
          <div className="min-w-[220px] flex-1">
            <div className="font-bold text-text-primary">Sign in to share files</div>
            <div className="text-sm text-text-secondary">Anyone with the link can download, no sign-in required.</div>
          </div>
          <Link to="/auth" className={buttonClasses("primary", "md")}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {srTitle}
      <p className="mb-4 text-sm text-text-secondary">
        Share files up to 5 GB with an expiring link. Stored encrypted at rest in Canada. Keep this tab open while uploading.
      </p>

      {error && <Alert variant="error" className="mb-3">{error}</Alert>}

      <FormCard onSubmit={handleUpload} className="space-y-2.5">
        <label
          className={`flex min-h-[110px] cursor-pointer items-center justify-center break-all rounded-ds-lg border-2 border-dashed p-4 text-center text-sm focus-within:ring-2 focus-within:ring-accent ${
            dragging ? "border-accent bg-surface-3" : "border-border-default bg-surface-0"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!uploading) pick(e.dataTransfer.files[0]);
          }}
        >
          <input type="file" className="sr-only" disabled={uploading} onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <span className="text-text-primary">
              {file.name} <span className="text-text-secondary">({formatBytes(file.size)})</span>
            </span>
          ) : (
            <span className="text-text-secondary">Drop a file here or click to choose one</span>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            aria-label="Expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as FileExpiry)}
            disabled={uploading}
            className={`${input} min-h-12 w-full sm:w-auto`}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            type="password"
            aria-label="Password (optional)"
            placeholder="Password (optional)"
            autoComplete="new-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={uploading}
            className={`${input} min-h-12 w-full sm:w-auto`}
          />
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} disabled={uploading} />
            One-time download
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="submit" disabled={!file || uploading} className={`${buttonClasses("primary", "lg")} w-full sm:w-auto`}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
          {uploading && (
            <button type="button" onClick={() => upload.current?.cancel()} className={buttonClasses("secondary", "lg")}>
              Cancel
            </button>
          )}
        </div>
        {uploading && (
          <div className="space-y-1" role="status">
            <progress className="h-2 w-full accent-[rgb(var(--color-hue-teal))]" value={progress.loaded} max={progress.total || 1} />
            <p className="text-xs text-text-secondary">
              {formatBytes(progress.loaded)} of {formatBytes(progress.total)} ({pct}%)
            </p>
          </div>
        )}
      </FormCard>

      {resultId && (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-3.5 rounded-ds-lg border px-4 py-3.5"
          style={{
            background: "color-mix(in srgb, rgb(var(--color-hue-teal)) 12%, rgb(var(--color-surface-2)))",
            borderColor: "color-mix(in srgb, rgb(var(--color-hue-teal)) 35%, transparent)",
          }}
        >
          <CheckCircle size={22} weight="regular" aria-hidden="true" className="shrink-0 text-[rgb(var(--color-hue-teal))]" />
          <div className="min-w-0 flex-1 basis-[200px]">
            <div className="text-xs font-semibold text-text-secondary">Share link ready</div>
            <div className="break-all font-heading text-[18px] font-semibold tracking-[-0.02em] text-text-primary">
              {shareUrlFor(resultId)}
            </div>
          </div>
          <CopyButton text={shareUrlFor(resultId)} size="md" />
        </div>
      )}

      <section className="mt-9" aria-labelledby="your-files-heading">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 id="your-files-heading" className="font-heading text-[20px] font-semibold text-text-primary">
            Your files
          </h2>
          {data && (
            <span className="text-xs text-text-secondary">
              {data.usage.count} of {data.usage.maxCount} files, {formatBytes(data.usage.bytes)} of {formatBytes(data.usage.maxBytes)} used
            </span>
          )}
        </div>

        {listError && <Alert variant="error" className="mb-3">{listError}</Alert>}

        <ListCard aria-busy={!data}>
          {!data ? (
            <ListRow>
              <div className="motion-safe:animate-pulse space-y-2">
                <div className="h-4 w-48 max-w-full rounded bg-surface-3" />
                <div className="h-3 w-32 max-w-full rounded bg-surface-3" />
              </div>
            </ListRow>
          ) : data.files.length === 0 ? (
            <ListEmpty>You haven't shared any files yet.</ListEmpty>
          ) : (
            data.files.map((f) => (
              <ListRow key={f.id}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="min-w-0 flex-1 basis-[260px]">
                    <div className="break-all text-[15px] font-bold text-text-primary">{f.name}</div>
                    <p className="text-xs text-text-secondary">
                      {formatBytes(f.size)} · {f.status} · expires {expiryLabel(f.expiresAt, Date.now())} · {f.downloadCount}{" "}
                      {f.downloadCount === 1 ? "download" : "downloads"}
                    </p>
                    {(f.hasPassword || f.oneTime) && (
                      <div className="mt-1 flex gap-1.5">
                        {f.hasPassword && <span className="tag tag-neutral">password</span>}
                        {f.oneTime && <span className="tag tag-neutral">one-time</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {f.status === "ready" && <CopyButton text={shareUrlFor(f.id)} label="Copy link" />}
                    {confirmId === f.id ? (
                      <>
                        <span className="text-xs text-text-secondary">Delete?</span>
                        <button type="button" onClick={() => remove(f.id)} className={buttonClasses("secondary", "sm")}>
                          Yes
                        </button>
                        <button type="button" onClick={() => setConfirmId(null)} className={buttonClasses("secondary", "sm")}>
                          No
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmId(f.id)} className={buttonClasses("secondary", "sm")}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </ListRow>
            ))
          )}
        </ListCard>
      </section>
    </div>
  );
};

export default FilesPage;
