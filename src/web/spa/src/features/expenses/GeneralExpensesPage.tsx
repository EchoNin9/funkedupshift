import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth, canAccessExpenses } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";
import { Alert } from "../../components";
import { AdminTabs } from "../admin/AdminTabs";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface ExpenseSection {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface GenAttachment {
  key: string;
  filename?: string;
  contentType?: string;
  size?: number;
  url?: string;
}

interface GenExpenseEntry {
  id: string;
  date?: string;
  price?: number;
  vendor?: string;
  description?: string;
  reimbursed?: boolean;
  attachments?: GenAttachment[];
  createdAt?: string;
  updatedAt?: string;
}

function formatDate(s: string | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s + "T12:00:00Z");
    if (isNaN(d.getTime())) return s;
    const y = d.getUTCFullYear();
    const m = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  } catch {
    return s || "—";
  }
}

function attachmentOpensInModal(a: GenAttachment): boolean {
  const ct = (a.contentType || "").toLowerCase();
  if (ct.startsWith("image/") || ct === "application/pdf") return true;
  const fn = (a.filename || a.key || "").toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fn)) return true;
  if (/\.pdf$/i.test(fn)) return true;
  return false;
}

const GeneralExpensesPage: React.FC = () => {
  const { user } = useAuth();
  const canAccess = canAccessExpenses(user);

  const [sections, setSections] = useState<ExpenseSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [entries, setEntries] = useState<GenExpenseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [limitOpen, setLimitOpen] = useState(false);
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    search: "",
    reimbursed: "all" as "all" | "yes" | "no",
    sortNewestFirst: true,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    date: "",
    price: "",
    vendor: "",
    description: "",
    reimbursed: false,
    attachments: [] as GenAttachment[],
  });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const pendingFilesRef = useRef<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Only reset add/edit draft when the user switches section, not when loadEntries ref or other deps retrigger the effect. */
  const prevSectionForDraftRef = useRef<string | null>(null);

  const [preview, setPreview] = useState<{ url: string; filename: string; isPdf: boolean } | null>(null);

  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);

  const loadSections = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/general-expenses`);
      if (!resp.ok) throw new Error("Failed to load sections");
      const data = (await resp.json()) as { sections?: ExpenseSection[] };
      const list = Array.isArray(data.sections) ? data.sections : [];
      setSections(list);
      setSelectedSectionId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEntries = useCallback(async (sectionId: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setLoadingEntries(true);
    try {
      const resp = await fetchWithAuth(`${apiBase}/general-expenses/${encodeURIComponent(sectionId)}/entries`);
      if (!resp.ok) throw new Error("Failed to load entries");
      const data = (await resp.json()) as { entries?: GenExpenseEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) loadSections();
    else setLoading(false);
  }, [canAccess, loadSections]);

  useEffect(() => {
    if (selectedSectionId) {
      loadEntries(selectedSectionId);
      if (prevSectionForDraftRef.current !== selectedSectionId) {
        prevSectionForDraftRef.current = selectedSectionId;
        setEditingId(null);
        setAddOpen(false);
        setPendingFiles([]);
      }
    } else {
      prevSectionForDraftRef.current = null;
      setEntries([]);
    }
  }, [selectedSectionId, loadEntries]);

  useEffect(() => {
    if (renamingSectionId && renamingSectionId !== selectedSectionId) {
      setRenamingSectionId(null);
      setRenameValue("");
    }
  }, [selectedSectionId, renamingSectionId]);

  const uploadFiles = useCallback(async (sectionId: string, files: File[]) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || files.length === 0) return [];
    const uploaded: GenAttachment[] = [];
    for (const file of files) {
      const declaredType = file.type || "application/octet-stream";
      const metaResp = await fetchWithAuth(
        `${apiBase}/general-expenses/${encodeURIComponent(sectionId)}/entries/upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: declaredType,
          }),
        }
      );
      if (!metaResp.ok) throw new Error(`Failed to get upload URL for ${file.name}`);
      const uploadMeta = (await metaResp.json()) as {
        uploadUrl?: string;
        key?: string;
        filename?: string;
        contentType?: string;
      };
      if (!uploadMeta.uploadUrl || !uploadMeta.key) throw new Error(`Upload URL missing for ${file.name}`);
      // Presigned PUT must use the same Content-Type the URL was signed with (S3 returns 403 on mismatch).
      const putContentType = (uploadMeta.contentType && uploadMeta.contentType.trim()) || declaredType;
      const putResp = await fetch(uploadMeta.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": putContentType },
        body: file,
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed for ${file.name} (HTTP ${putResp.status})`);
      }
      uploaded.push({
        key: uploadMeta.key,
        filename: uploadMeta.filename || file.name,
        contentType: putContentType,
        size: file.size,
      });
    }
    return uploaded;
  }, []);

  const handleAddSection = async () => {
    const name = newSectionName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/general-expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || "Could not create section");
      }
      const created = (await resp.json()) as ExpenseSection;
      setSections((prev) => [...prev, created].sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setSelectedSectionId(created.id);
      setNewSectionName("");
      setShowAddSection(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRenameSection = async (sectionId: string, name: string) => {
    const n = name.trim();
    if (!n) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/general-expenses/${encodeURIComponent(sectionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (!resp.ok) throw new Error("Rename failed");
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name: n } : s)));
      setRenamingSectionId(null);
      setRenameValue("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    if (!window.confirm("Delete this section and all its expense entries?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/general-expenses/${encodeURIComponent(sectionId)}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error("Delete failed");
      const remaining = sections.filter((s) => s.id !== sectionId);
      setSections(remaining);
      setSelectedSectionId(remaining[0]?.id ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setForm({
      date: new Date().toISOString().slice(0, 10),
      price: "",
      vendor: "",
      description: "",
      reimbursed: false,
      attachments: [],
    });
    setPendingFiles([]);
  };

  const openAdd = () => {
    resetForm();
    setAddOpen(true);
    setEditingId(null);
  };

  const openEdit = (e: GenExpenseEntry) => {
    setForm({
      date: e.date || "",
      price: String(e.price ?? ""),
      vendor: e.vendor || "",
      description: e.description || "",
      reimbursed: !!e.reimbursed,
      attachments: e.attachments ? [...e.attachments] : [],
    });
    setPendingFiles([]);
    setEditingId(e.id);
    setAddOpen(false);
  };

  const submitEntry = async () => {
    if (!selectedSectionId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const date = form.date.trim();
    const price = parseFloat(form.price);
    if (!date || isNaN(price)) {
      setError("Date and valid price are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let attachments = [...form.attachments];
      const filesToUpload = [...pendingFilesRef.current];
      if (filesToUpload.length > 0) {
        const up = await uploadFiles(selectedSectionId, filesToUpload);
        attachments = [...attachments, ...up];
        setPendingFiles([]);
      }
      const body = {
        date,
        price,
        vendor: form.vendor.trim(),
        description: form.description.trim(),
        reimbursed: form.reimbursed,
        attachments: attachments.map(({ key, filename, contentType, size }) => ({
          key,
          filename,
          contentType,
          size,
        })),
      };
      if (editingId) {
        const resp = await fetchWithAuth(
          `${apiBase}/general-expenses/${encodeURIComponent(selectedSectionId)}/entries/${encodeURIComponent(editingId)}`,
          { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || "Update failed");
        }
        const updated = (await resp.json()) as GenExpenseEntry;
        setEntries((prev) => prev.map((x) => (x.id === editingId ? updated : x)));
        setEditingId(null);
      } else {
        const resp = await fetchWithAuth(
          `${apiBase}/general-expenses/${encodeURIComponent(selectedSectionId)}/entries`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        if (!resp.ok) {
          const j = await resp.json().catch(() => ({}));
          throw new Error((j as { error?: string }).error || "Create failed");
        }
        const created = (await resp.json()) as GenExpenseEntry;
        setEntries((prev) => [created, ...prev]);
        setAddOpen(false);
        resetForm();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!selectedSectionId || !window.confirm("Delete this entry?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/general-expenses/${encodeURIComponent(selectedSectionId)}/entries/${encodeURIComponent(entryId)}`,
        { method: "DELETE" }
      );
      if (!resp.ok) throw new Error("Delete failed");
      setEntries((prev) => prev.filter((x) => x.id !== entryId));
      if (editingId === entryId) setEditingId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  const removeAttachment = (key: string) => {
    setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.key !== key) }));
  };

  const filteredEntries = useMemo(() => {
    let list = [...entries];
    const { startDate, endDate, search, reimbursed, sortNewestFirst } = filters;
    if (startDate) list = list.filter((e) => (e.date ?? "") >= startDate);
    if (endDate) list = list.filter((e) => (e.date ?? "") <= endDate);
    if (reimbursed === "yes") list = list.filter((e) => e.reimbursed);
    if (reimbursed === "no") list = list.filter((e) => !e.reimbursed);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) => {
        const v = (e.vendor ?? "").toLowerCase();
        const d = (e.description ?? "").toLowerCase();
        return v.includes(q) || d.includes(q);
      });
    }
    list.sort((a, b) => {
      const ad = a.date ?? "";
      const bd = b.date ?? "";
      return sortNewestFirst ? bd.localeCompare(ad) : ad.localeCompare(bd);
    });
    return list;
  }, [entries, filters]);

  const openAttachment = (a: GenAttachment) => {
    const url = a.url;
    if (!url) return;
    if (attachmentOpensInModal(a)) {
      const isPdf =
        (a.contentType || "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(a.filename || a.key || "");
      setPreview({ url, filename: a.filename || "file", isPdf });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-sans font-bold text-text-primary">General expenses</h1>
        <p className="text-text-secondary">Sign in to access your expenses.</p>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-sans font-bold text-text-primary">General expenses</h1>
        <p className="text-text-secondary">
          You need to be in the expenses group to access this section. Contact an admin to be added.
        </p>
      </div>
    );
  }

  const tabs = [
    ...sections.map((s) => ({ id: s.id, label: s.name || "Unnamed" })),
    { id: "__add__", label: "+ Add section" },
  ];
  const activeTabId = showAddSection ? "__add__" : (selectedSectionId ?? "__add__");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-sans font-bold text-text-primary">General expenses</h1>
        <p className="text-text-secondary mt-1">Track expenses by section. Data is private to you.</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <p className="text-text-secondary">Loading…</p>
      ) : (
        <>
          <AdminTabs
            tabs={tabs}
            activeId={activeTabId}
            onSelect={(id) => {
              if (id === "__add__") {
                setShowAddSection(true);
                setSelectedSectionId(null);
              } else {
                setShowAddSection(false);
                setSelectedSectionId(id);
              }
            }}
          />

          {showAddSection ? (
            <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
              <h2 className="text-sm font-semibold text-text-secondary mb-3">Add section</h2>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Section name"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary placeholder-text-tertiary flex-1 min-w-[12rem]"
                />
                <button
                  type="button"
                  onClick={handleAddSection}
                  disabled={saving || !newSectionName.trim()}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add"}
                </button>
              </div>
            </div>
          ) : selectedSectionId ? (
            <>
              <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    {renamingSectionId === selectedSectionId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSection(selectedSectionId, renameValue);
                            if (e.key === "Escape") {
                              setRenamingSectionId(null);
                              setRenameValue("");
                            }
                          }}
                          className="rounded-md border border-border-hover bg-surface-3 px-3 py-1.5 text-text-primary w-48"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameSection(selectedSectionId, renameValue)}
                          disabled={saving || !renameValue.trim()}
                          className="text-sm text-accent-400 hover:text-accent-300"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingSectionId(null);
                            setRenameValue("");
                          }}
                          className="text-sm text-text-secondary hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-sm font-semibold text-text-secondary">
                          {sections.find((s) => s.id === selectedSectionId)?.name || "Section"}
                        </h2>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingSectionId(selectedSectionId);
                            setRenameValue(sections.find((s) => s.id === selectedSectionId)?.name || "");
                          }}
                          disabled={saving}
                          className="text-xs text-text-secondary hover:text-text-primary"
                        >
                          Rename
                        </button>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSection(selectedSectionId)}
                    disabled={saving}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Delete section
                  </button>
                </div>

                <div className="rounded-lg border border-border-hover bg-surface-3 overflow-hidden mb-4">
                  <button
                    type="button"
                    onClick={() => setLimitOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-3/30 transition-colors"
                  >
                    <span className="text-sm font-medium text-text-primary">Limit results</span>
                    <span className="text-text-secondary">{limitOpen ? "▼" : "▶"}</span>
                  </button>
                  {limitOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-border-hover grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Start date</label>
                        <input
                          type="date"
                          value={filters.startDate}
                          onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">End date</label>
                        <input
                          type="date"
                          value={filters.endDate}
                          onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Search (vendor / description)</label>
                        <input
                          type="text"
                          value={filters.search}
                          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                          placeholder="Filter…"
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Reimbursed</label>
                        <select
                          value={filters.reimbursed}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              reimbursed: e.target.value as "all" | "yes" | "no",
                            }))
                          }
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        >
                          <option value="all">All</option>
                          <option value="yes">Reimbursed only</option>
                          <option value="no">Not reimbursed</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Sort</label>
                        <select
                          value={filters.sortNewestFirst ? "newest" : "oldest"}
                          onChange={(e) =>
                            setFilters((f) => ({ ...f, sortNewestFirst: e.target.value === "newest" }))
                          }
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        >
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <p className="text-sm text-text-secondary">
                    Expenses ({filters.sortNewestFirst ? "newest first" : "oldest first"})
                    {filteredEntries.length !== entries.length && (
                      <span className="text-text-primary0 ml-1">
                        ({filteredEntries.length} of {entries.length})
                      </span>
                    )}
                  </p>
                  {!addOpen && !editingId && (
                    <button
                      type="button"
                      onClick={openAdd}
                      disabled={saving}
                      className="rounded-md bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                    >
                      Add expense
                    </button>
                  )}
                </div>

                {(addOpen || editingId) && (
                  <div className="rounded-lg border border-accent-500/40 bg-surface-1 p-4 mb-4 space-y-3">
                    <h3 className="text-sm font-semibold text-text-primary">{editingId ? "Edit expense" : "New expense"}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Date</label>
                        <input
                          type="date"
                          value={form.date}
                          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Price</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={form.price}
                          onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                          placeholder="0.00"
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-text-primary0 mb-1">Vendor</label>
                        <input
                          type="text"
                          value={form.vendor}
                          onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-text-primary0 mb-1">Description</label>
                        <textarea
                          value={form.description}
                          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                          rows={2}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <input
                          id="ge-reimbursed"
                          type="checkbox"
                          checked={form.reimbursed}
                          onChange={(e) => setForm((f) => ({ ...f, reimbursed: e.target.checked }))}
                          className="rounded border-border-hover"
                        />
                        <label htmlFor="ge-reimbursed" className="text-sm text-text-primary">
                          Reimbursed
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-text-primary0 mb-1">Attachments</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.txt,.csv,.doc,.docx,.xls,.xlsx,.webp,.gif"
                        className="hidden"
                        onChange={(e) => {
                          const fl = e.target.files;
                          if (fl?.length) setPendingFiles((p) => [...p, ...Array.from(fl)]);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-sm text-accent-400 hover:text-accent-300"
                      >
                        Add files…
                      </button>
                      {pendingFiles.length > 0 && (
                        <ul className="text-xs text-text-secondary mt-1 space-y-0.5">
                          {pendingFiles.map((f, i) => (
                            <li key={`${f.name}-${i}`}>{f.name} (pending upload)</li>
                          ))}
                        </ul>
                      )}
                      {form.attachments.length > 0 && (
                        <ul className="text-xs mt-2 space-y-1">
                          {form.attachments.map((a) => (
                            <li key={a.key} className="flex items-center justify-between gap-2">
                              <span className="text-text-secondary truncate">{a.filename || a.key}</span>
                              <button
                                type="button"
                                onClick={() => removeAttachment(a.key)}
                                className="text-red-400 hover:text-red-300 shrink-0"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={submitEntry}
                        disabled={saving}
                        className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddOpen(false);
                          setEditingId(null);
                          resetForm();
                          setPendingFiles([]);
                        }}
                        disabled={saving}
                        className="rounded-md border border-border-hover px-4 py-2 text-sm text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {loadingEntries ? (
                  <p className="text-text-secondary text-sm">Loading entries…</p>
                ) : filteredEntries.length === 0 ? (
                  <p className="text-text-secondary text-sm">
                    {entries.length === 0 ? "No entries yet. Add an expense above." : "No entries match the current filters."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {filteredEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-border-hover bg-surface-3 p-4"
                      >
                        {editingId === entry.id ? (
                          <p className="text-sm text-text-secondary italic">Editing in the form above.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-sm text-text-primary">
                                <span className="font-medium">{formatDate(entry.date)}</span>
                                {" — "}
                                <span className="font-medium">${Number(entry.price || 0).toFixed(2)}</span>
                                {entry.reimbursed && (
                                  <span className="ml-2 text-xs text-accent-400">Reimbursed</span>
                                )}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEdit(entry)}
                                  disabled={saving || addOpen}
                                  className="text-sm text-text-secondary hover:text-text-primary"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  disabled={saving}
                                  className="text-sm text-red-400 hover:text-red-300"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            {entry.vendor && (
                              <p className="text-xs text-text-primary0">Vendor: {entry.vendor}</p>
                            )}
                            {entry.description && (
                              <p className="text-sm text-text-secondary">{entry.description}</p>
                            )}
                            {(entry.attachments || []).length > 0 && (
                              <ul className="text-xs text-text-primary0 space-y-1">
                                {(entry.attachments || []).map((a) => (
                                  <li key={a.key}>
                                    <button
                                      type="button"
                                      onClick={() => openAttachment(a)}
                                      className="text-accent-400 hover:text-accent-300 text-left underline-offset-2 hover:underline"
                                    >
                                      {a.filename || a.key}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-text-secondary">Add a section to get started.</p>
          )}
        </>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-label="Attachment preview"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-surface-2 rounded-lg border border-border-hover max-w-4xl w-full max-h-[90vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-hover">
              <span className="text-sm font-medium text-text-primary truncate pr-2">{preview.filename}</span>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="text-text-secondary hover:text-text-primary text-sm shrink-0"
              >
                Close
              </button>
            </div>
            <div className="p-2 overflow-auto flex-1 flex items-center justify-center min-h-[200px]">
              {preview.isPdf ? (
                <iframe
                  title={preview.filename}
                  src={preview.url}
                  className="w-full h-[70vh] rounded border border-border-hover bg-white"
                />
              ) : (
                <img
                  src={preview.url}
                  alt={preview.filename}
                  className="max-w-full max-h-[70vh] object-contain rounded"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GeneralExpensesPage;
