import React, { useEffect, useState } from "react";
import { Alert } from "../../components";
import { apiSend } from "./api";

/** Edit the user's category list (chips + add). Defaults seed new users server-side. */
const CategoriesSection: React.FC<{ categories: string[]; onChanged: () => void }> = ({ categories, onChanged }) => {
  const [list, setList] = useState<string[]>(categories);
  const [newCat, setNewCat] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setList(categories);
  }, [categories, dirty]);

  const add = () => {
    const name = newCat.trim();
    if (!name || list.some((c) => c.toLowerCase() === name.toLowerCase())) return;
    setList([...list, name]);
    setNewCat("");
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSend("PUT", "/finances/categories", { categories: list });
      setDirty(false);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border-default bg-surface-1 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-text-primary uppercase">Categories</h2>
      <div className="flex flex-wrap gap-2">
        {list.map((c) => (
          <span key={c}
            className="inline-flex items-center gap-2 rounded-full border border-border-hover px-3 py-1 text-sm text-text-secondary">
            {c}
            <button type="button" aria-label={`Remove category ${c}`}
              onClick={() => { setList(list.filter((x) => x !== c)); setDirty(true); }}
              className="text-text-tertiary hover:text-red-400">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          aria-label="New category"
          placeholder="New category"
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          className="rounded-md border border-border-hover bg-surface-1 px-3 py-2 text-sm text-text-primary"
        />
        <button type="button" onClick={add} disabled={!newCat.trim()}
          className="rounded-md border border-accent-500 px-3 py-2 text-sm font-medium text-accent-500 hover:bg-surface-2 disabled:opacity-50">
          Add
        </button>
        <button type="button" onClick={save} disabled={busy || !dirty || list.length === 0}
          className="rounded-md bg-accent-500 px-3 py-2 text-sm font-medium text-surface-0 hover:bg-orange-500 disabled:opacity-50">
          {busy ? "Saving…" : "Save categories"}
        </button>
        <span className="text-xs text-text-tertiary">
          Removing a category doesn&apos;t change past transactions — use the bulk-categorize checkboxes to relabel them.
        </span>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
    </div>
  );
};

export default CategoriesSection;
