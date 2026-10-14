import React, { useEffect, useState } from "react";
import { AdminPageHeader } from "./AdminPageHeader";
import { Alert } from "../../components";
import { fetchWithAuth } from "../../utils/api";
import { refreshCatalog, useThemeState, type ThemeMode, type ThemeRecord } from "../../shell/theme";
import { Segmented, ThemeChip, ThemePreview } from "../../shell/ThemeChips";

function apiBase(): string {
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : "";
}

type Draft = Omit<ThemeRecord, "id" | "builtin"> & { id?: string };

const BLANK: Draft = { name: "", tint: 285, accent: "#7c5cff", discover: "#33c9aa", tools: "#9a82ff", modules: "#ff7f5c", admin: "#f2b73f" };

const COLOR_FIELDS: { key: "accent" | "discover" | "tools" | "modules" | "admin"; label: string }[] = [
  { key: "accent", label: "Accent" },
  { key: "discover", label: "Discover" },
  { key: "tools", label: "Tools" },
  { key: "modules", label: "Modules" },
  { key: "admin", label: "Admin" },
];

const MODES = [
  { value: "dark" as ThemeMode, label: "Dark" },
  { value: "light" as ThemeMode, label: "Light" },
];

async function errorMessage(resp: Response): Promise<string> {
  try {
    const d = await resp.json();
    if (d?.error) return String(d.error);
  } catch {
    /* not JSON */
  }
  return `Request failed (${resp.status})`;
}

function ThemeDialog({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview: ThemeRecord = { id: draft.id ?? "__draft", ...draft };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name || name.length > 40) {
      setError("Name must be 1–40 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { id, ...fields } = draft;
      const resp = await fetchWithAuth(`${apiBase()}/themes${id ? `/${encodeURIComponent(id)}` : ""}`, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, name }),
      });
      if (!resp.ok) {
        setError(await errorMessage(resp));
        return;
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the theme.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto p-4" style={{ background: "rgb(0 0 0 / .55)" }} onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-dialog-title"
        onSubmit={save}
        className="w-full max-w-lg rounded-2xl border bg-surface-1 p-5 shadow-ds-lg"
        style={{ borderColor: "var(--color-divider)" }}
      >
        <h2 id="theme-dialog-title" className="mb-4 font-display text-lg font-semibold text-text-primary">
          {initial.id ? "Edit theme" : "New theme"}
        </h2>
        <label className="mb-1 block text-sm font-semibold text-text-primary" htmlFor="theme-name">Name</label>
        <input id="theme-name" className="input-field mb-4 w-full" value={draft.name} maxLength={40} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

        <label className="mb-1 block text-sm font-semibold text-text-primary" htmlFor="theme-tint">
          Ground tint <span className="font-normal text-text-secondary">({Math.round(draft.tint)}°)</span>
        </label>
        <input id="theme-tint" type="range" min={0} max={360} value={draft.tint} onChange={(e) => setDraft({ ...draft, tint: Number(e.target.value) })} className="mb-4 w-full" style={{ accentColor: "rgb(var(--color-accent))" }} />

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COLOR_FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm text-text-primary">
              <input type="color" aria-label={`${f.label} colour`} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} className="h-9 w-9 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
              <span className="min-w-0">
                <span className="block font-semibold">{f.label}</span>
                <span className="block font-mono text-xs text-text-secondary">{draft[f.key]}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <ThemePreview theme={preview} mode="dark" />
          <ThemePreview theme={preview} mode="light" />
        </div>

        {error && <div className="mb-3"><Alert variant="error">{error}</Alert></div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save theme"}</button>
        </div>
      </form>
    </div>
  );
}

/** Admin › Themes: site defaults, theme cards (dark + light previews), create / edit / delete. */
const ThemesAdminPage: React.FC = () => {
  const { themes, defaultThemeId, defaultMode, theme: activeTheme, mode } = useThemeState();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void refreshCatalog();
  }, []);

  const call = async (path: string, init: RequestInit, done: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const resp = await fetchWithAuth(`${apiBase()}${path}`, { ...init, headers: { "Content-Type": "application/json" } });
      if (!resp.ok) {
        setError(await errorMessage(resp));
        return false;
      }
      await refreshCatalog();
      setMessage(done);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const putSettings = (body: { defaultThemeId?: string; defaultMode?: ThemeMode }, done: string) =>
    call("/site-settings", { method: "PUT", body: JSON.stringify(body) }, done);

  const remove = (t: ThemeRecord) => {
    if (!window.confirm(`Delete the "${t.name}" theme? Anyone using it will switch to the site default.`)) return;
    void call(`/themes/${encodeURIComponent(t.id)}`, { method: "DELETE" }, `Deleted “${t.name}”.`);
  };

  return (
    <div className="container-max section-padding space-y-6">
      <AdminPageHeader
        description="Colour themes available in the account menu. Every theme works in dark and light."
        actions={<button type="button" className="btn-primary" onClick={() => setEditing({ ...BLANK })}>New theme</button>}
      />

      {error && <Alert variant="error">{error}</Alert>}
      {message && <Alert variant="success">{message}</Alert>}

      <section className="rounded-2xl border bg-surface-2 p-4" style={{ borderColor: "var(--color-divider)" }} aria-labelledby="site-defaults">
        <h2 id="site-defaults" className="font-display text-base font-semibold text-text-primary">Site defaults</h2>
        <p className="mb-3 text-sm text-text-secondary">Used for guests and for people who haven’t chosen a theme or mode.</p>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-tertiary">Default theme</p>
        <div role="radiogroup" aria-label="Default theme" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {themes.map((t) => (
            <ThemeChip key={t.id} theme={t} mode={mode} selected={t.id === defaultThemeId} onSelect={() => !busy && t.id !== defaultThemeId && void putSettings({ defaultThemeId: t.id }, `“${t.name}” is now the site default.`)} />
          ))}
        </div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-tertiary">Default mode</p>
        <div className="max-w-xs">
          <Segmented label="Default mode" value={defaultMode} options={MODES} onChange={(m) => !busy && m !== defaultMode && void putSettings({ defaultMode: m }, `Default mode set to ${m}.`)} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {themes.map((t) => {
          const isDefault = t.id === defaultThemeId;
          return (
            <article key={t.id} className="rounded-2xl border bg-surface-2 p-4" style={{ borderColor: "var(--color-divider)" }}>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <ThemePreview theme={t} mode="dark" />
                <ThemePreview theme={t} mode="light" />
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-base font-semibold text-text-primary">{t.name}</h3>
                {isDefault && <span className="tag tag-accent">Site default</span>}
                {t.id === activeTheme.id && <span className="tag tag-neutral">Your theme</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" disabled={busy || isDefault} onClick={() => void putSettings({ defaultThemeId: t.id }, `“${t.name}” is now the site default.`)}>Make default</button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing({ id: t.id, name: t.name, tint: t.tint, accent: t.accent, discover: t.discover, tools: t.tools, modules: t.modules, admin: t.admin })}>Edit</button>
                <button type="button" className="btn-secondary" disabled={busy || isDefault} title={isDefault ? "The site default can’t be deleted" : undefined} onClick={() => remove(t)}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <ThemeDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            const wasEdit = !!editing.id;
            setEditing(null);
            void refreshCatalog().then(() => setMessage(wasEdit ? "Theme updated." : "Theme created."));
          }}
        />
      )}
    </div>
  );
};

export default ThemesAdminPage;
