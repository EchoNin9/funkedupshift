import React, { useEffect, useRef, useState } from "react";
import {
  FILE_MAX_BYTES,
  FILE_TOO_LARGE_MESSAGE,
  FileExpiry,
  FileList,
  FileUpload,
  UPLOAD_CANCELLED,
  deleteFile,
  isAuthError,
  listFiles,
  startUpload
} from "./api";
import { expiryLabel, formatBytes, shareUrlFor } from "./filedrop";

interface Props {
  onBack: () => void;
  onAuthError: () => void;
}

const EXPIRY_OPTIONS: { value: FileExpiry; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" }
];

const FileDropTool: React.FC<Props> = ({ onBack, onAuthError }) => {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expiry, setExpiry] = useState<FileExpiry>("1d");
  const [password, setPassword] = useState("");
  const [oneTime, setOneTime] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [data, setData] = useState<FileList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const upload = useRef<FileUpload | null>(null);

  const load = async () => {
    setListError(null);
    try {
      setData(await listFiles());
    } catch (err) {
      if (isAuthError(err)) return onAuthError();
      setListError(err instanceof Error ? err.message : "Failed to load your files.");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Leaving the tool mid-upload cancels it (and deletes the partial upload).
  useEffect(() => () => upload.current?.cancel(), []);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setResultId(null);
    setError(f.size > FILE_MAX_BYTES ? FILE_TOO_LARGE_MESSAGE : null);
    setFile(f.size > FILE_MAX_BYTES ? null : f);
  };

  const handleUpload: React.FormEventHandler = async (e) => {
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
      if (isAuthError(err)) onAuthError();
      else if (!(err instanceof Error && err.message === UPLOAD_CANCELLED)) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    } finally {
      upload.current = null;
      setUploading(false);
      load();
    }
  };

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(shareUrlFor(id));
    } catch {
      // link is shown on screen regardless
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    try {
      await deleteFile(id);
    } catch (err) {
      if (isAuthError(err)) return onAuthError();
      setListError(err instanceof Error ? err.message : "Failed to delete file.");
    }
    load();
  };

  const pct = progress.total ? Math.floor((progress.loaded / progress.total) * 100) : 0;

  return (
    <section className="tool-view">
      <button type="button" className="btn btn-ghost back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h1 className="tool-heading">File Drop</h1>
      <p className="textshare-residency-note">
        Share files up to 5 GB with an expiring link. Stored encrypted at rest in Canada. Keep this tab open while uploading.
      </p>

      <form className="textshare-form" onSubmit={handleUpload}>
        <label
          className={`filedrop-zone${dragging ? " filedrop-zone-active" : ""}`}
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
          <input type="file" disabled={uploading} onChange={(e) => pick(e.target.files?.[0])} />
          {file ? (
            <span>
              {file.name} <span className="muted">({formatBytes(file.size)})</span>
            </span>
          ) : (
            <span className="muted">Drop a file here or click to choose one</span>
          )}
        </label>
        <div className="textshare-controls">
          <select value={expiry} onChange={(e) => setExpiry(e.target.value as FileExpiry)} aria-label="Expiry" disabled={uploading}>
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            type="password"
            className="filedrop-password"
            placeholder="Password (optional)"
            autoComplete="new-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={uploading}
          />
          <label className="filedrop-check">
            <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} disabled={uploading} />
            One-time download
          </label>
        </div>
        <div className="textshare-controls">
          <button type="submit" className="btn btn-primary" disabled={!file || uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
          {uploading && (
            <button type="button" className="btn btn-danger" onClick={() => upload.current?.cancel()}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {uploading && (
        <div className="filedrop-progress">
          <progress value={progress.loaded} max={progress.total || 1} />
          <span className="muted">
            {formatBytes(progress.loaded)} of {formatBytes(progress.total)} ({pct}%)
          </span>
        </div>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {resultId && (
        <div className="mint-result">
          <code>{shareUrlFor(resultId)}</code>
          <button type="button" className="btn btn-ghost" onClick={() => copy(resultId)}>
            {copiedId === resultId ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      <h2 className="links-heading">Your files</h2>
      {data && (
        <p className="muted">
          {data.usage.count} of {data.usage.maxCount} files, {formatBytes(data.usage.bytes)} of {formatBytes(data.usage.maxBytes)} used
        </p>
      )}

      {listError && <div className="banner banner-error">{listError}</div>}

      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.files.length === 0 ? (
        <p className="muted">You haven't shared any files yet.</p>
      ) : (
        <ul className="link-list">
          {data.files.map((f) => (
            <li key={f.id} className="link-row">
              <div className="link-main">
                <strong className="filedrop-name">{f.name}</strong>
                <span className="expiry">
                  {formatBytes(f.size)} · {f.status} · expires {expiryLabel(f.expiresAt, Date.now())} · {f.downloadCount}{" "}
                  {f.downloadCount === 1 ? "download" : "downloads"}
                </span>
                {(f.hasPassword || f.oneTime) && (
                  <span className="filedrop-badges">
                    {f.hasPassword && <span className="filedrop-badge">password</span>}
                    {f.oneTime && <span className="filedrop-badge">one-time</span>}
                  </span>
                )}
              </div>
              <div className="link-meta">
                {f.status === "ready" && (
                  <button type="button" className="btn btn-ghost" onClick={() => copy(f.id)}>
                    {copiedId === f.id ? "Copied!" : "Copy link"}
                  </button>
                )}
                {confirmId === f.id ? (
                  <>
                    <span className="expiry">Delete?</span>
                    <button type="button" className="btn btn-danger" onClick={() => remove(f.id)}>
                      Yes
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmId(null)}>
                      No
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirmId(f.id)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default FileDropTool;
