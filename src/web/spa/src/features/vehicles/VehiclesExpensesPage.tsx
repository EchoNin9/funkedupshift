import React, { useCallback, useEffect, useState, useRef } from "react";
import { useAuth, canAccessExpenses } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";
import { Alert } from "../../components";
import { AdminTabs } from "../admin/AdminTabs";
import AddTagInput from "../memes/AddTagInput";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as any).API_BASE_URL as string | undefined;
  return raw ? raw.replace(/\/$/, "") : null;
}

interface Vehicle {
  id: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface FuelEntry {
  id: string;
  date?: string;
  fuelPrice?: number;
  fuel_price?: number; // legacy API key
  fuelLitres?: number;
  odometerKm?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface MaintenanceAttachment {
  key: string;
  filename?: string;
  contentType?: string;
  size?: number;
  url?: string;
}

interface MaintenanceEntry {
  id: string;
  date?: string;
  price?: number;
  mileage?: number;
  description?: string;
  vendor?: string;
  tags?: string[];
  attachments?: MaintenanceAttachment[];
  createdAt?: string;
  updatedAt?: string;
}

/** Parse CSV text into rows. Handles quoted fields. */
function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out;
  });
}

/** Strip currency symbols and parse number. Handles $65.00, €50, 65,50 (EU) etc. */
function parseCurrency(val: string | number | undefined): number {
  if (val == null || val === "") return 0;
  if (typeof val === "number" && !isNaN(val)) return val;
  let s = String(val).replace(/[$€£¥\s]/g, "");
  if (s.includes(".")) s = s.replace(/,/g, "");
  else s = s.replace(/,/g, ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** Normalize vehicle name: trim, collapse empty to single default. */
function normalizeVehicleName(s: string | undefined): string {
  const t = String(s ?? "").trim();
  return t || "Vehicle";
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

/** Simple SVG line chart - no external deps. */
function LineChart({
  data,
  valueKey,
  label,
  formatValue,
  color,
}: {
  data: { date: string; [k: string]: unknown }[];
  valueKey: string;
  label: string;
  formatValue: (v: number) => string;
  color: string;
}) {
  if (data.length === 0) return null;
  const w = 600;
  const h = 180;
  const pad = { t: 20, r: 40, b: 30, l: 50 };
  const values = data.map((d) => d[valueKey] as number).filter((v) => v != null && !isNaN(v));
  const minV = Math.min(...values, 0);
  const maxV = Math.max(...values, minV + 0.01);
  const range = maxV - minV || 1;
  const xScale = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * (w - pad.l - pad.r);
  const yScale = (v: number) => pad.t + h - pad.t - pad.b - ((v - minV) / range) * (h - pad.t - pad.b);
  const pts = data
    .map((d, i) => {
      const v = d[valueKey] as number;
      if (v == null || isNaN(v)) return null;
      return `${xScale(i)},${yScale(v)}`;
    })
    .filter(Boolean) as string[];
  return (
    <div className="mb-4">
      <p className="text-xs font-medium text-text-secondary mb-1">{label}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-full" preserveAspectRatio="xMidYMid meet">
        <line x1={pad.l} y1={h - pad.b} x2={w - pad.r} y2={h - pad.b} stroke="currentColor" strokeOpacity={0.2} />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={h - pad.b} stroke="currentColor" strokeOpacity={0.2} />
        {pts.length > 1 && (
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pts.join(" ")}
          />
        )}
        {data.map((d, i) => {
          const v = d[valueKey] as number;
          if (v == null || isNaN(v)) return null;
          return (
            <circle key={i} cx={xScale(i)} cy={yScale(v)} r="3" fill={color} />
          );
        })}
      </svg>
      <p className="text-xs text-text-primary0 mt-1">
        Range: {formatValue(minV)} – {formatValue(maxV)}
      </p>
    </div>
  );
}

function calcFuelMetrics(
  entry: FuelEntry,
  prevEntry: FuelEntry | null
): { pricePerLitre: number | null; distanceKm: number; lPer100km: number | null; mpg: number | null } {
  const price = entry.fuelPrice ?? entry.fuel_price ?? 0;
  const litres = entry.fuelLitres ?? 0;
  const odometer = entry.odometerKm ?? 0;
  const prevOdometer = prevEntry?.odometerKm ?? odometer;
  const distanceKm = Math.max(0, odometer - prevOdometer);
  const pricePerLitre = litres > 0 ? price / litres : null;
  const lPer100km = distanceKm > 0 && litres > 0 ? (litres / distanceKm) * 100 : null;
  const mpg = lPer100km != null && lPer100km > 0 ? 235.215 / lPer100km : null;
  return { pricePerLitre, distanceKm, lPer100km, mpg };
}

const VehiclesExpensesPage: React.FC = () => {
  const { user } = useAuth();
  const canAccess = canAccessExpenses(user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [fuelEntries, setFuelEntries] = useState<FuelEntry[]>([]);
  const [maintenanceEntries, setMaintenanceEntries] = useState<MaintenanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeExpenseTab, setActiveExpenseTab] = useState<"fuel" | "maintenance" | "totals">("fuel");
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicleName, setNewVehicleName] = useState("");
  const [fuelForm, setFuelForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fuelPrice: "",
    fuelLitres: "",
    odometerKm: "",
  });
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showImportHelp, setShowImportHelp] = useState(false);
  const [maintenanceTags, setMaintenanceTags] = useState<string[]>([]);
  const [maintenanceVendors, setMaintenanceVendors] = useState<string[]>([]);
  const [maintenanceForm, setMaintenanceForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    price: "",
    mileage: "",
    description: "",
    vendor: "",
    tags: [] as string[],
    attachments: [] as MaintenanceAttachment[],
  });
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [editingMaintenanceId, setEditingMaintenanceId] = useState<string | null>(null);
  const [editMaintenanceForm, setEditMaintenanceForm] = useState({
    date: "",
    price: "",
    mileage: "",
    description: "",
    vendor: "",
    tags: [] as string[],
    attachments: [] as MaintenanceAttachment[],
  });
  const [renamingVehicleId, setRenamingVehicleId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [editingFuelId, setEditingFuelId] = useState<string | null>(null);
  const [editFuelForm, setEditFuelForm] = useState({
    date: "",
    fuelPrice: "",
    fuelLitres: "",
    odometerKm: "",
  });
  const [limitResultsOpen, setLimitResultsOpen] = useState(false);
  const [maintenanceLimitResultsOpen, setMaintenanceLimitResultsOpen] = useState(false);
  const [totalsLimitResultsOpen, setTotalsLimitResultsOpen] = useState(false);
  const [displayGraphOpen, setDisplayGraphOpen] = useState(false);
  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    sortNewestFirst: true,
    fuelPriceOp: "higher" as "higher" | "lower",
    fuelPriceVal: "",
    pricePerLOp: "higher" as "higher" | "lower",
    pricePerLVal: "",
  });
  const [maintenanceFilters, setMaintenanceFilters] = useState({
    startDate: "",
    endDate: "",
    sortNewestFirst: true,
    priceOp: "higher" as "higher" | "lower",
    priceVal: "",
    mileageOp: "higher" as "higher" | "lower",
    mileageVal: "",
    vendorQuery: "",
  });
  const [totalsFilters, setTotalsFilters] = useState({
    startDate: "",
    endDate: "",
  });

  const loadVehicles = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/vehicles-expenses`);
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to load vehicles");
      }
      const data = (await resp.json()) as { vehicles?: Vehicle[] };
      const list = data.vehicles ?? [];
      setVehicles(list);
      if (list.length > 0 && !selectedVehicleId) {
        setSelectedVehicleId(list[0].id);
      }
      if (selectedVehicleId && !list.find((v) => v.id === selectedVehicleId)) {
        setSelectedVehicleId(list[0]?.id ?? null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load vehicles");
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [selectedVehicleId]);

  const loadFuelEntries = useCallback(async (vehicleId: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setFuelLoading(true);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(vehicleId)}/fuel`
      );
      if (!resp.ok) throw new Error("Failed to load fuel entries");
      const data = (await resp.json()) as { entries?: FuelEntry[] };
      const entries = data.entries ?? [];
      entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setFuelEntries(entries);
    } catch {
      setFuelEntries([]);
    } finally {
      setFuelLoading(false);
    }
  }, []);

  const loadMaintenanceEntries = useCallback(async (vehicleId: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setMaintenanceLoading(true);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(vehicleId)}/maintenance`
      );
      if (!resp.ok) throw new Error("Failed to load maintenance entries");
      const data = (await resp.json()) as { entries?: MaintenanceEntry[] };
      const entries = data.entries ?? [];
      entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setMaintenanceEntries(entries);
    } catch {
      setMaintenanceEntries([]);
    } finally {
      setMaintenanceLoading(false);
    }
  }, []);

  const loadMaintenanceTags = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/vehicles-expenses/maintenance-tags`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { tags?: string[] };
      setMaintenanceTags(Array.isArray(data.tags) ? data.tags : []);
    } catch {
      setMaintenanceTags([]);
    }
  }, []);

  const loadMaintenanceVendors = useCallback(async () => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    try {
      const resp = await fetchWithAuth(`${apiBase}/vehicles-expenses/maintenance-vendors`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { vendors?: string[] };
      setMaintenanceVendors(Array.isArray(data.vendors) ? data.vendors : []);
    } catch {
      setMaintenanceVendors([]);
    }
  }, []);

  const fetchMaintenanceTags = useCallback(async (q: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return [];
    const resp = await fetchWithAuth(
      `${apiBase}/vehicles-expenses/maintenance-tags?q=${encodeURIComponent(q)}`
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as { tags?: string[] };
    return Array.isArray(data.tags) ? data.tags : [];
  }, []);

  const fetchMaintenanceVendors = useCallback(async (q: string) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase) return [];
    const resp = await fetchWithAuth(
      `${apiBase}/vehicles-expenses/maintenance-vendors?q=${encodeURIComponent(q)}`
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as { vendors?: string[] };
    const vendors = Array.isArray(data.vendors) ? data.vendors : [];
    setMaintenanceVendors(vendors);
    return vendors;
  }, []);

  const uploadMaintenanceFiles = useCallback(async (vehicleId: string, files: File[]) => {
    const apiBase = getApiBaseUrl();
    if (!apiBase || files.length === 0) return [];
    const uploaded: MaintenanceAttachment[] = [];
    for (const file of files) {
      const metaResp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(vehicleId)}/maintenance/upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
          }),
        }
      );
      if (!metaResp.ok) {
        throw new Error(`Failed to get upload URL for ${file.name}`);
      }
      const uploadMeta = (await metaResp.json()) as { uploadUrl?: string; key?: string; filename?: string; contentType?: string };
      if (!uploadMeta.uploadUrl || !uploadMeta.key) {
        throw new Error(`Upload URL missing for ${file.name}`);
      }
      const putResp = await fetch(uploadMeta.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed for ${file.name}`);
      }
      uploaded.push({
        key: uploadMeta.key,
        filename: uploadMeta.filename || file.name,
        contentType: uploadMeta.contentType || file.type || "application/octet-stream",
        size: file.size,
      });
    }
    return uploaded;
  }, []);

  useEffect(() => {
    if (canAccess) {
      loadVehicles();
      loadMaintenanceTags();
      loadMaintenanceVendors();
    }
    else setLoading(false);
  }, [canAccess, loadVehicles, loadMaintenanceTags, loadMaintenanceVendors]);

  useEffect(() => {
    if (selectedVehicleId) {
      loadFuelEntries(selectedVehicleId);
      loadMaintenanceEntries(selectedVehicleId);
    } else {
      setFuelEntries([]);
      setMaintenanceEntries([]);
    }
  }, [selectedVehicleId, loadFuelEntries, loadMaintenanceEntries]);

  useEffect(() => {
    if (renamingVehicleId && renamingVehicleId !== selectedVehicleId) {
      setRenamingVehicleId(null);
      setRenameValue("");
    }
  }, [selectedVehicleId, renamingVehicleId]);

  useEffect(() => {
    setEditingFuelId(null);
    setEditingMaintenanceId(null);
  }, [selectedVehicleId]);

  const pricePerLitreByEntry = React.useMemo(() => {
    const map = new Map<string, number | null>();
    for (let i = 0; i < fuelEntries.length; i++) {
      const prev = fuelEntries[i + 1] ?? null;
      const { pricePerLitre } = calcFuelMetrics(fuelEntries[i], prev);
      map.set(fuelEntries[i].id, pricePerLitre);
    }
    return map;
  }, [fuelEntries]);

  const filteredEntries = React.useMemo(() => {
    let list = [...fuelEntries];
    const { startDate, endDate, sortNewestFirst, fuelPriceOp, fuelPriceVal, pricePerLOp, pricePerLVal } = filters;
    if (startDate) list = list.filter((e) => (e.date ?? "") >= startDate);
    if (endDate) list = list.filter((e) => (e.date ?? "") <= endDate);
    const fpVal = parseFloat(fuelPriceVal);
    if (!isNaN(fpVal) && fuelPriceVal) {
      list = list.filter((e) => {
        const p = e.fuelPrice ?? e.fuel_price ?? 0;
        return fuelPriceOp === "higher" ? p >= fpVal : p <= fpVal;
      });
    }
    const pplVal = parseFloat(pricePerLVal);
    if (!isNaN(pplVal) && pricePerLVal) {
      list = list.filter((e) => {
        const ppl = pricePerLitreByEntry.get(e.id);
        if (ppl == null) return false;
        return pricePerLOp === "higher" ? ppl >= pplVal : ppl <= pplVal;
      });
    }
    list.sort((a, b) =>
      sortNewestFirst
        ? (b.date || "").localeCompare(a.date || "")
        : (a.date || "").localeCompare(b.date || "")
    );
    return list;
  }, [fuelEntries, filters, pricePerLitreByEntry]);

  const filteredMaintenanceEntries = React.useMemo(() => {
    let list = [...maintenanceEntries];
    const {
      startDate,
      endDate,
      sortNewestFirst,
      priceOp,
      priceVal,
      mileageOp,
      mileageVal,
      vendorQuery,
    } = maintenanceFilters;

    if (startDate) list = list.filter((e) => (e.date ?? "") >= startDate);
    if (endDate) list = list.filter((e) => (e.date ?? "") <= endDate);

    const pVal = parseFloat(priceVal);
    if (!isNaN(pVal) && priceVal) {
      list = list.filter((e) => {
        const p = e.price ?? 0;
        return priceOp === "higher" ? p >= pVal : p <= pVal;
      });
    }

    const mVal = parseFloat(mileageVal);
    if (!isNaN(mVal) && mileageVal) {
      list = list.filter((e) => {
        const m = e.mileage ?? 0;
        return mileageOp === "higher" ? m >= mVal : m <= mVal;
      });
    }

    const vq = vendorQuery.trim().toLowerCase();
    if (vq) {
      list = list.filter((e) => (e.vendor ?? "").toLowerCase().includes(vq));
    }

    list.sort((a, b) =>
      sortNewestFirst
        ? (b.date || "").localeCompare(a.date || "")
        : (a.date || "").localeCompare(b.date || "")
    );
    return list;
  }, [maintenanceEntries, maintenanceFilters]);

  const filteredFuelEntriesForTotals = React.useMemo(() => {
    let list = [...fuelEntries];
    if (totalsFilters.startDate) list = list.filter((e) => (e.date ?? "") >= totalsFilters.startDate);
    if (totalsFilters.endDate) list = list.filter((e) => (e.date ?? "") <= totalsFilters.endDate);
    return list;
  }, [fuelEntries, totalsFilters]);

  const filteredMaintenanceEntriesForTotals = React.useMemo(() => {
    let list = [...maintenanceEntries];
    if (totalsFilters.startDate) list = list.filter((e) => (e.date ?? "") >= totalsFilters.startDate);
    if (totalsFilters.endDate) list = list.filter((e) => (e.date ?? "") <= totalsFilters.endDate);
    return list;
  }, [maintenanceEntries, totalsFilters]);

  const totalsSummary = React.useMemo(() => {
    const fuelTotal = filteredFuelEntriesForTotals.reduce((sum, e) => sum + (e.fuelPrice ?? e.fuel_price ?? 0), 0);
    const maintenanceTotal = filteredMaintenanceEntriesForTotals.reduce((sum, e) => sum + (e.price ?? 0), 0);
    return {
      fuelTotal,
      maintenanceTotal,
      combinedTotal: fuelTotal + maintenanceTotal,
    };
  }, [filteredFuelEntriesForTotals, filteredMaintenanceEntriesForTotals]);

  const handleAddVehicle = async () => {
    const name = newVehicleName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(`${apiBase}/vehicles-expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to create");
      }
      const v = (await resp.json()) as Vehicle;
      setVehicles((prev) => [...prev, v]);
      setSelectedVehicleId(v.id);
      setNewVehicleName("");
      setShowAddVehicle(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create vehicle");
    } finally {
      setSaving(false);
    }
  };

  const handleAddFuel = async () => {
    if (!selectedVehicleId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const price = parseFloat(fuelForm.fuelPrice);
    const litres = parseFloat(fuelForm.fuelLitres);
    const odometer = parseFloat(fuelForm.odometerKm);
    if (isNaN(price) || isNaN(litres) || isNaN(odometer)) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/fuel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: fuelForm.date,
            fuelPrice: price,
            fuelLitres: litres,
            odometerKm: odometer,
          }),
        }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to add");
      }
      setFuelForm({
        date: new Date().toISOString().slice(0, 10),
        fuelPrice: "",
        fuelLitres: "",
        odometerKm: "",
      });
      loadFuelEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add fuel entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVehicle = async (vehicleId: string) => {
    const v = vehicles.find((x) => x.id === vehicleId);
    const name = v?.name || "this vehicle";
    if (!window.confirm(`Delete "${name}"? This will permanently remove the vehicle and all its fuel entries.`)) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(vehicleId)}`,
        { method: "DELETE" }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to delete");
      }
      setVehicles((prev) => prev.filter((x) => x.id !== vehicleId));
      if (selectedVehicleId === vehicleId) {
        const remaining = vehicles.filter((x) => x.id !== vehicleId);
        setSelectedVehicleId(remaining[0]?.id ?? null);
      }
      setFuelEntries([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete vehicle");
    } finally {
      setSaving(false);
    }
  };

  const handleRenameVehicle = async (vehicleId: string, newName: string) => {
    const name = newName.trim();
    if (!name) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(vehicleId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to rename");
      }
      const updated = (await resp.json()) as Vehicle;
      setVehicles((prev) =>
        prev.map((v) => (v.id === vehicleId ? { ...v, name: updated.name } : v))
      );
      setRenamingVehicleId(null);
      setRenameValue("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to rename vehicle");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateFuel = async (fillupId: string) => {
    if (!selectedVehicleId) return;
    const price = parseFloat(editFuelForm.fuelPrice);
    const litres = parseFloat(editFuelForm.fuelLitres);
    const odometer = parseFloat(editFuelForm.odometerKm);
    if (isNaN(price) || isNaN(litres) || isNaN(odometer)) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/fuel/${encodeURIComponent(fillupId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: editFuelForm.date,
            fuelPrice: price,
            fuelLitres: litres,
            odometerKm: odometer,
          }),
        }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to update");
      }
      setEditingFuelId(null);
      loadFuelEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update fuel entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFuel = async (fillupId: string) => {
    if (!selectedVehicleId || !window.confirm("Delete this fuel entry?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/fuel/${encodeURIComponent(fillupId)}`,
        { method: "DELETE" }
      );
      if (!resp.ok) throw new Error("Failed to delete");
      setEditingFuelId(null);
      loadFuelEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const handleAddMaintenance = async () => {
    if (!selectedVehicleId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const price = parseFloat(maintenanceForm.price);
    const mileage = parseFloat(maintenanceForm.mileage);
    if (isNaN(price) || isNaN(mileage) || !maintenanceForm.date) return;
    setSaving(true);
    setError(null);
    try {
      const uploaded = await uploadMaintenanceFiles(selectedVehicleId, pendingAttachments);
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/maintenance`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: maintenanceForm.date,
            price,
            mileage,
            description: maintenanceForm.description.trim(),
            vendor: maintenanceForm.vendor.trim(),
            tags: maintenanceForm.tags,
            attachments: uploaded,
          }),
        }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to add maintenance entry");
      }
      setMaintenanceForm({
        date: new Date().toISOString().slice(0, 10),
        price: "",
        mileage: "",
        description: "",
        vendor: "",
        tags: [],
        attachments: [],
      });
      setPendingAttachments([]);
      loadMaintenanceEntries(selectedVehicleId);
      loadMaintenanceTags();
      loadMaintenanceVendors();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add maintenance entry");
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateMaintenance = async (maintenanceId: string) => {
    if (!selectedVehicleId) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    const price = parseFloat(editMaintenanceForm.price);
    const mileage = parseFloat(editMaintenanceForm.mileage);
    if (isNaN(price) || isNaN(mileage) || !editMaintenanceForm.date) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/maintenance/${encodeURIComponent(maintenanceId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: editMaintenanceForm.date,
            price,
            mileage,
            description: editMaintenanceForm.description.trim(),
            vendor: editMaintenanceForm.vendor.trim(),
            tags: editMaintenanceForm.tags,
            attachments: editMaintenanceForm.attachments,
          }),
        }
      );
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to update maintenance entry");
      }
      setEditingMaintenanceId(null);
      loadMaintenanceEntries(selectedVehicleId);
      loadMaintenanceTags();
      loadMaintenanceVendors();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update maintenance entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMaintenance = async (maintenanceId: string) => {
    if (!selectedVehicleId || !window.confirm("Delete this maintenance entry?")) return;
    const apiBase = getApiBaseUrl();
    if (!apiBase) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetchWithAuth(
        `${apiBase}/vehicles-expenses/${encodeURIComponent(selectedVehicleId)}/maintenance/${encodeURIComponent(maintenanceId)}`,
        { method: "DELETE" }
      );
      if (!resp.ok) throw new Error("Failed to delete maintenance entry");
      setEditingMaintenanceId(null);
      loadMaintenanceEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete maintenance entry");
    } finally {
      setSaving(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    setError(null);
    try {
      let rows: (string | number)[][];
      let excelEpoch = 25569;

      const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
      if (isCsv) {
        const text = await file.text();
        rows = parseCSV(text);
        if (!rows.length) throw new Error("CSV file is empty");
      } else {
        const XLSX = await import("xlsx");
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: "array", raw: true });
        const sheetName = wb.SheetNames[0];
        if (!sheetName) throw new Error("Excel file has no sheets");
        const ws = wb.Sheets[sheetName];
        if (!ws) throw new Error("Could not read first sheet");
        rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: true, defval: "" }) as (string | number)[][];
        if (!rows.length) throw new Error("Excel sheet is empty");
        const date1904 = !!(wb.Workbook?.WBProps as { date1904?: boolean } | undefined)?.date1904;
        excelEpoch = date1904 ? 24107 : 25569;
      }

      const imports: { vehicleName: string; entries: { date: string; fuelPrice: number; fuelLitres: number; odometerKm: number }[] }[] = [];
      const colMap: Record<string, number> = {};
      const headerRow = rows[0] as (string | number)[];
      // Map columns by header content so columns can be in any order
      for (let i = 0; i < headerRow.length; i++) {
        const h = String(headerRow[i] ?? "").toLowerCase().trim();
        if (!h) continue;
        if (h.includes("date")) colMap.date = i;
        else if (h.includes("litre") || h.includes("liter") || h.includes("volume")) colMap.fuelLitres = i;
        else if (h.includes("price") || h.includes("cost") || h.includes("amount")) colMap.fuelPrice = i;
        else if (h.includes("odometer") || h.includes("mileage") || (h.includes("km") && !h.includes("l/100"))) colMap.odometerKm = i;
        else if (h.includes("vehicle") || h === "car" || h.includes("car name")) colMap.vehicle = i;
      }
      const dateCol = colMap.date ?? 0;
      const priceCol = colMap.fuelPrice ?? 1;
      const litresCol = colMap.fuelLitres ?? 2;
      const odoCol = colMap.odometerKm ?? 3;
      // Only read vehicle from a column we explicitly detected; otherwise use single default vehicle for all rows.
      // Using a default index (e.g. 4) when Vehicle column is missing can read Odometer/Date and create one vehicle per row.
      const vehicleCol = colMap.vehicle;
      const byVehicle: Record<string, { date: string; fuelPrice: number; fuelLitres: number; odometerKm: number }[]> = {};
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] as (string | number)[];
        if (!Array.isArray(row)) continue;
        const dateVal = row[dateCol];
        const priceVal = row[priceCol];
        const litresVal = row[litresCol];
        const odoVal = row[odoCol];
        const vehicleVal = vehicleCol !== undefined ? row[vehicleCol] : undefined;
        if (dateVal == null && priceVal == null && litresVal == null && odoVal == null) continue;
        if (dateVal === "" && priceVal === "" && litresVal === "" && odoVal === "") continue;
        let dateStr = "";
        if (typeof dateVal === "number" && !isNaN(dateVal) && dateVal > 0) {
          const d = new Date((dateVal - excelEpoch) * 86400 * 1000);
          dateStr = d.toISOString().slice(0, 10);
        } else {
          dateStr = String(dateVal ?? "").trim().slice(0, 10);
        }
        const price = parseCurrency(priceVal);
        const litres = typeof litresVal === "number" && !isNaN(litresVal) ? litresVal : parseFloat(String(litresVal ?? "").replace(/,/g, "")) || 0;
        const odo = typeof odoVal === "number" && !isNaN(odoVal) ? odoVal : parseFloat(String(odoVal ?? "").replace(/,/g, "")) || 0;
        const vehicleName = normalizeVehicleName(vehicleVal);
        if (!byVehicle[vehicleName]) byVehicle[vehicleName] = [];
        byVehicle[vehicleName].push({ date: dateStr, fuelPrice: price, fuelLitres: litres, odometerKm: odo });
      }
      for (const [vName, entries] of Object.entries(byVehicle)) {
        if (entries.length > 0) imports.push({ vehicleName: vName, entries });
      }
      if (imports.length === 0) {
        throw new Error("No valid data rows found. Ensure columns: Date, Fuel Price, Fuel Litres, Odometer (km), Vehicle.");
      }
      const apiBase = getApiBaseUrl();
      if (!apiBase) throw new Error("API URL not set");

      const BATCH_SIZE = 50;
      const chunks: { vehicleName: string; entries: { date: string; fuelPrice: number; fuelLitres: number; odometerKm: number }[] }[] = [];
      for (const imp of imports) {
        for (let i = 0; i < imp.entries.length; i += BATCH_SIZE) {
          chunks.push({
            vehicleName: imp.vehicleName,
            entries: imp.entries.slice(i, i + BATCH_SIZE),
          });
        }
      }

      let totalCreated = 0;
      const allErrors: string[] = [];
      for (const chunk of chunks) {
        const bodyStr = JSON.stringify({ imports: [chunk] });
        const resp = await fetchWithAuth(`${apiBase}/vehicles-expenses/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: bodyStr,
        });
        const respText = await resp.text();
        if (!resp.ok) {
          const d = (() => {
            try {
              return JSON.parse(respText) as { error?: string; errors?: string[] };
            } catch {
              return {};
            }
          })();
          const errMsg = d.error;
          const errList = d.errors;
          const fallback = resp.status === 500 && respText
            ? `Import failed (500): ${respText.slice(0, 300)}${respText.length > 300 ? "…" : ""}`
            : `Import failed (${resp.status})`;
          throw new Error(errMsg || (errList?.length ? errList.join("; ") : null) || fallback);
        }
        const result = JSON.parse(respText) as { created?: number; errors?: string[] };
        totalCreated += result.created ?? 0;
        if ((result.errors ?? []).length) allErrors.push(...result.errors!);
      }
      setImportMessage(`Imported ${totalCreated} entries.${allErrors.length ? ` Errors: ${allErrors.join("; ")}` : ""}`);
      loadVehicles();
      if (selectedVehicleId) loadFuelEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-sans font-bold text-text-primary">Vehicles Expenses</h1>
        <p className="text-text-secondary">Sign in to access your vehicle expenses.</p>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-sans font-bold text-text-primary">Vehicles Expenses</h1>
        <p className="text-text-secondary">
          You need to be in the expenses group to access this section. Contact an admin to be added.
        </p>
      </div>
    );
  }

  const tabs = [
    ...vehicles.map((v) => ({ id: v.id, label: v.name || "Unnamed" })),
    { id: "__add__", label: "+ Add vehicle" },
  ];
  const activeId = showAddVehicle ? "__add__" : (selectedVehicleId ?? "__add__");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-sans font-bold text-text-primary">Vehicles Expenses</h1>
          <p className="text-text-secondary mt-1">Track fuel costs per vehicle. Data is private to you.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleImport}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-md border border-border-hover bg-surface-3 px-4 py-2 text-sm text-text-primary hover:bg-surface-3 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import from CSV/Excel"}
          </button>
          <button
            type="button"
            onClick={() => setShowImportHelp((v) => !v)}
            className="text-sm text-text-secondary hover:text-text-primary"
          >
            {showImportHelp ? "Hide format" : "Import format"}
          </button>
        </div>
      </div>

      {showImportHelp && (
        <div className="rounded-lg border border-border-hover bg-surface-2 p-4 text-sm text-text-secondary space-y-2">
          <p className="font-medium text-text-primary">CSV / Excel import format</p>
          <p>Use columns: <strong>Date</strong> (YYYY-MM-DD), <strong>Fuel Price</strong> ($), <strong>Fuel Litres</strong>, <strong>Odometer (km)</strong>, <strong>Vehicle</strong>. First row = headers. CSV or Excel (.xlsx, .xls) supported.</p>
        </div>
      )}

      {error && (
        <Alert variant="error">{error}</Alert>
      )}
      {importMessage && (
        <Alert variant="success">{importMessage}</Alert>
      )}

      <AdminTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={(id) => {
          if (id === "__add__") {
            setShowAddVehicle(true);
            setSelectedVehicleId(null);
          } else {
            setShowAddVehicle(false);
            setSelectedVehicleId(id);
            setActiveExpenseTab("fuel");
          }
        }}
      />

      {showAddVehicle ? (
        <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Add vehicle</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Vehicle name"
              value={newVehicleName}
              onChange={(e) => setNewVehicleName(e.target.value)}
              className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary placeholder-text-tertiary flex-1"
            />
            <button
              onClick={handleAddVehicle}
              disabled={saving || !newVehicleName.trim()}
              className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      ) : selectedVehicleId ? (
        <>
          <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {renamingVehicleId === selectedVehicleId ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameVehicle(selectedVehicleId, renameValue);
                        if (e.key === "Escape") {
                          setRenamingVehicleId(null);
                          setRenameValue("");
                        }
                      }}
                      placeholder="Vehicle name"
                      className="rounded-md border border-border-hover bg-surface-3 px-3 py-1.5 text-text-primary placeholder-text-tertiary w-48"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenameVehicle(selectedVehicleId, renameValue)}
                      disabled={saving || !renameValue.trim()}
                      className="text-sm text-accent-400 hover:text-accent-300"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setRenamingVehicleId(null);
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
                      {vehicles.find((v) => v.id === selectedVehicleId)?.name || "Vehicle"}
                    </h2>
                    <button
                      onClick={() => {
                        setRenamingVehicleId(selectedVehicleId);
                        setRenameValue(vehicles.find((v) => v.id === selectedVehicleId)?.name || "");
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
                onClick={() => handleDeleteVehicle(selectedVehicleId)}
                disabled={saving}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Delete vehicle
              </button>
            </div>
            <div className="mb-4 flex gap-2 border-b border-border-hover pb-2">
              <button
                type="button"
                onClick={() => setActiveExpenseTab("fuel")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeExpenseTab === "fuel"
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Fuel
              </button>
              <button
                type="button"
                onClick={() => setActiveExpenseTab("maintenance")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeExpenseTab === "maintenance"
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Maintenance
              </button>
              <button
                type="button"
                onClick={() => setActiveExpenseTab("totals")}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  activeExpenseTab === "totals"
                    ? "bg-surface-3 text-text-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                Totals
              </button>
            </div>
            {activeExpenseTab === "fuel" ? (
              <>
            <h2 className="text-sm font-semibold text-text-secondary mb-3">Add fuel expense</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="date"
                value={fuelForm.date}
                onChange={(e) => setFuelForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Fuel price ($)"
                value={fuelForm.fuelPrice}
                onChange={(e) => setFuelForm((f) => ({ ...f, fuelPrice: e.target.value }))}
                className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary placeholder-text-tertiary"
              />
              <input
                type="number"
                step="0.001"
                placeholder="Fuel litres"
                value={fuelForm.fuelLitres}
                onChange={(e) => setFuelForm((f) => ({ ...f, fuelLitres: e.target.value }))}
                className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary placeholder-text-tertiary"
              />
              <input
                type="number"
                step="1"
                placeholder="Odometer (km)"
                value={fuelForm.odometerKm}
                onChange={(e) => setFuelForm((f) => ({ ...f, odometerKm: e.target.value }))}
                className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary placeholder-text-tertiary"
              />
            </div>
            <button
              onClick={handleAddFuel}
              disabled={saving || !fuelForm.fuelPrice || !fuelForm.fuelLitres || !fuelForm.odometerKm}
              className="mt-3 rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add fuel entry"}
            </button>
              </>
            ) : activeExpenseTab === "maintenance" ? (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-text-secondary">Add maintenance expense</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={maintenanceForm.date}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, date: e.target.value }))}
                    className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
                  />
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price ($)"
                    value={maintenanceForm.price}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, price: e.target.value }))}
                    className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
                  />
                  <input
                    type="number"
                    step="1"
                    placeholder="Mileage (km)"
                    value={maintenanceForm.mileage}
                    onChange={(e) => setMaintenanceForm((f) => ({ ...f, mileage: e.target.value }))}
                    className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
                  />
                  <input
                    type="text"
                    list="maintenance-vendors-list"
                    placeholder="Vendor"
                    value={maintenanceForm.vendor}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMaintenanceForm((f) => ({ ...f, vendor: value }));
                      void fetchMaintenanceVendors(value);
                    }}
                    className="rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
                  />
                </div>
                <textarea
                  rows={3}
                  placeholder="Description"
                  value={maintenanceForm.description}
                  onChange={(e) => setMaintenanceForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-text-primary"
                />
                <div>
                  <p className="mb-2 text-xs text-text-primary0">Tags</p>
                  <AddTagInput
                    tags={maintenanceForm.tags}
                    onTagsChange={(tags) => setMaintenanceForm((f) => ({ ...f, tags }))}
                    allTags={maintenanceTags}
                    fetchTags={fetchMaintenanceTags}
                    placeholder="Add maintenance tags"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs text-text-primary0">Attachments</label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.txt,.csv,.doc,.docx,.xls,.xlsx,.webp,.gif"
                    onChange={(e) => setPendingAttachments(Array.from(e.target.files || []))}
                    className="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-text-primary"
                  />
                  {pendingAttachments.length > 0 && (
                    <p className="mt-1 text-xs text-text-primary0">
                      {pendingAttachments.length} file(s) selected: {pendingAttachments.map((f) => f.name).join(", ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleAddMaintenance}
                  disabled={saving || !maintenanceForm.date || !maintenanceForm.price || !maintenanceForm.mileage}
                  className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add maintenance entry"}
                </button>
                <datalist id="maintenance-vendors-list">
                  {maintenanceVendors.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </div>
            ) : (
              <div className="rounded-lg border border-border-hover bg-surface-3 p-4">
                <p className="text-sm text-text-secondary">
                  Totals summary for the selected vehicle. Use the Totals tab filters below to limit the time range.
                </p>
              </div>
            )}
          </div>

          {activeExpenseTab === "fuel" && (
          <>
          <div className="rounded-lg border border-border-hover bg-surface-3 overflow-hidden">
            <button
              type="button"
              onClick={() => setLimitResultsOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-3/30 transition-colors"
            >
              <span className="text-sm font-medium text-text-primary">Limit results</span>
              <span className="text-text-secondary">{limitResultsOpen ? "▼" : "▶"}</span>
            </button>
            {limitResultsOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-border-hover space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                    <label className="block text-xs text-text-primary0 mb-1">Sort order</label>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-text-primary0 mb-1">Fuel price ($)</label>
                      <div className="flex gap-2">
                        <select
                          value={filters.fuelPriceOp}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              fuelPriceOp: e.target.value as "higher" | "lower",
                            }))
                          }
                          className="rounded-md border border-border-hover bg-surface-3 px-2 py-2 text-sm text-text-primary"
                        >
                          <option value="higher">Higher than</option>
                          <option value="lower">Lower than</option>
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="e.g. 50"
                          value={filters.fuelPriceVal}
                          onChange={(e) => setFilters((f) => ({ ...f, fuelPriceVal: e.target.value }))}
                          className="flex-1 rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-text-primary0 mb-1">$/L</label>
                      <div className="flex gap-2">
                        <select
                          value={filters.pricePerLOp}
                          onChange={(e) =>
                            setFilters((f) => ({
                              ...f,
                              pricePerLOp: e.target.value as "higher" | "lower",
                            }))
                          }
                          className="rounded-md border border-border-hover bg-surface-3 px-2 py-2 text-sm text-text-primary"
                        >
                          <option value="higher">Higher than</option>
                          <option value="lower">Lower than</option>
                        </select>
                        <input
                          type="number"
                          step="0.001"
                          placeholder="e.g. 1.50"
                          value={filters.pricePerLVal}
                          onChange={(e) => setFilters((f) => ({ ...f, pricePerLVal: e.target.value }))}
                          className="flex-1 rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-hover bg-surface-3 overflow-hidden">
            <button
              type="button"
              onClick={() => setDisplayGraphOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-3/30 transition-colors"
            >
              <span className="text-sm font-medium text-text-primary">Display graph</span>
              <span className="text-text-secondary">{displayGraphOpen ? "▼" : "▶"}</span>
            </button>
            {displayGraphOpen && (
              <div className="px-4 pb-4 pt-4 border-t border-border-hover">
                <div className="rounded-lg border border-border-hover bg-surface-2 p-4 min-h-[200px]">
                  {filteredEntries.length < 2 ? (
                    <p className="text-text-primary0 text-sm py-8 text-center">
                      Add at least 2 fuel entries to display the graph.
                    </p>
                  ) : (
                    (() => {
                      const chrono = [...filteredEntries].reverse();
                      const chartData = chrono.map((e, i) => {
                        const prev = i > 0 ? chrono[i - 1] : null;
                        const m = calcFuelMetrics(e, prev);
                        return {
                          date: e.date ?? "",
                          pricePerLitre: m.pricePerLitre,
                          lPer100km: m.lPer100km,
                        };
                      });
                      return (
                        <div className="space-y-6">
                          <LineChart
                            data={chartData}
                            valueKey="pricePerLitre"
                            label="$/L (cost per litre)"
                            formatValue={(v) => `$${v.toFixed(4)}`}
                            color="rgb(99 102 241)"
                          />
                          <LineChart
                            data={chartData}
                            valueKey="lPer100km"
                            label="L/100km (fuel efficiency)"
                            formatValue={(v) => v.toFixed(2)}
                            color="rgb(34 197 94)"
                          />
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border-hover bg-surface-2 overflow-hidden">
            <h2 className="text-sm font-semibold text-text-secondary px-4 py-3 border-b border-border-hover">
              Fuel expenses ({filters.sortNewestFirst ? "newest first" : "oldest first"})
              {filteredEntries.length !== fuelEntries.length && (
                <span className="font-normal text-text-primary0 ml-2">
                  ({filteredEntries.length} of {fuelEntries.length})
                </span>
              )}
            </h2>
            {fuelLoading ? (
              <div className="p-8 text-center text-text-primary0">Loading…</div>
            ) : filteredEntries.length === 0 ? (
              <div className="p-8 text-center text-text-primary0">
                {fuelEntries.length === 0
                  ? "No fuel entries yet. Add one above."
                  : "No entries match the current filters. Adjust or clear filters."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border-hover">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Fuel price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Volume</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">$/L</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">L/100km</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">MPG</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Odometer</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Distance</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-text-secondary uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-hover">
                    {filteredEntries.map((entry, idx) => {
                      const prev = filteredEntries[idx + 1] ?? null;
                      const { pricePerLitre, distanceKm, lPer100km, mpg } = calcFuelMetrics(entry, prev);
                      const isEditing = editingFuelId === entry.id;
                      return (
                        <tr key={entry.id} className="hover:bg-surface-3">
                          {isEditing ? (
                            <>
                              <td className="px-4 py-2">
                                <input
                                  type="date"
                                  value={editFuelForm.date}
                                  onChange={(e) => setEditFuelForm((f) => ({ ...f, date: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleUpdateFuel(entry.id);
                                    if (e.key === "Escape") setEditingFuelId(null);
                                  }}
                                  className="rounded border border-border-hover bg-surface-3 px-2 py-1 text-sm text-text-primary w-36"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editFuelForm.fuelPrice}
                                  onChange={(e) => setEditFuelForm((f) => ({ ...f, fuelPrice: e.target.value }))}
                                  className="rounded border border-border-hover bg-surface-3 px-2 py-1 text-sm text-text-primary w-20 text-right"
                                />
                              </td>
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  step="0.001"
                                  value={editFuelForm.fuelLitres}
                                  onChange={(e) => setEditFuelForm((f) => ({ ...f, fuelLitres: e.target.value }))}
                                  className="rounded border border-border-hover bg-surface-3 px-2 py-1 text-sm text-text-primary w-20 text-right"
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-text-primary0">—</td>
                              <td className="px-4 py-2 text-sm text-text-primary0">—</td>
                              <td className="px-4 py-2 text-sm text-text-primary0">—</td>
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  step="1"
                                  value={editFuelForm.odometerKm}
                                  onChange={(e) => setEditFuelForm((f) => ({ ...f, odometerKm: e.target.value }))}
                                  placeholder="Odometer"
                                  className="rounded border border-border-hover bg-surface-3 px-2 py-1 text-sm text-text-primary w-24 text-right"
                                />
                              </td>
                              <td className="px-4 py-2 text-sm text-text-primary0">—</td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  onClick={() => handleUpdateFuel(entry.id)}
                                  disabled={saving || !editFuelForm.date || !editFuelForm.fuelPrice || !editFuelForm.fuelLitres || !editFuelForm.odometerKm}
                                  className="text-accent-400 hover:text-accent-300 text-sm mr-2"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingFuelId(null);
                                  }}
                                  disabled={saving}
                                  className="text-text-secondary hover:text-text-primary text-sm mr-2"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleDeleteFuel(entry.id)}
                                  disabled={saving}
                                  className="text-red-400 hover:text-red-300 text-sm"
                                >
                                  Delete
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 text-sm text-text-primary">{formatDate(entry.date)}</td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                ${(entry.fuelPrice ?? entry.fuel_price ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {(entry.fuelLitres ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3 })}L
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {pricePerLitre != null
                                  ? `$${pricePerLitre.toLocaleString(undefined, { minimumFractionDigits: 4 })}/L`
                                  : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {lPer100km != null ? lPer100km.toFixed(2) : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {mpg != null ? mpg.toFixed(1) : "—"}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {(entry.odometerKm ?? 0).toLocaleString()} km
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-text-secondary">
                                {distanceKm > 0 ? `${distanceKm.toLocaleString()} km` : "—"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  onClick={() => {
                                    setEditingFuelId(entry.id);
                                    setEditFuelForm({
                                      date: entry.date ?? "",
                                      fuelPrice: String(entry.fuelPrice ?? entry.fuel_price ?? ""),
                                      fuelLitres: String(entry.fuelLitres ?? ""),
                                      odometerKm: String(entry.odometerKm ?? ""),
                                    });
                                  }}
                                  disabled={saving}
                                  className="text-text-secondary hover:text-text-primary text-sm mr-2"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteFuel(entry.id)}
                                  disabled={saving}
                                  className="text-red-400 hover:text-red-300 text-sm"
                                >
                                  Delete
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
          )}

          {activeExpenseTab === "maintenance" && (
            <>
            <div className="rounded-lg border border-border-hover bg-surface-3 overflow-hidden">
              <button
                type="button"
                onClick={() => setMaintenanceLimitResultsOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-3/30 transition-colors"
              >
                <span className="text-sm font-medium text-text-primary">Limit results</span>
                <span className="text-text-secondary">{maintenanceLimitResultsOpen ? "▼" : "▶"}</span>
              </button>
              {maintenanceLimitResultsOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border-hover space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-text-primary0 mb-1">Start date</label>
                      <input
                        type="date"
                        value={maintenanceFilters.startDate}
                        onChange={(e) => setMaintenanceFilters((f) => ({ ...f, startDate: e.target.value }))}
                        className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-primary0 mb-1">End date</label>
                      <input
                        type="date"
                        value={maintenanceFilters.endDate}
                        onChange={(e) => setMaintenanceFilters((f) => ({ ...f, endDate: e.target.value }))}
                        className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-primary0 mb-1">Sort order</label>
                      <select
                        value={maintenanceFilters.sortNewestFirst ? "newest" : "oldest"}
                        onChange={(e) =>
                          setMaintenanceFilters((f) => ({ ...f, sortNewestFirst: e.target.value === "newest" }))
                        }
                        className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-text-primary0 mb-1">Vendor contains</label>
                      <input
                        type="text"
                        value={maintenanceFilters.vendorQuery}
                        onChange={(e) => setMaintenanceFilters((f) => ({ ...f, vendorQuery: e.target.value }))}
                        className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        placeholder="e.g. quick"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-text-primary0 mb-1">Price ($)</label>
                        <div className="flex gap-2">
                          <select
                            value={maintenanceFilters.priceOp}
                            onChange={(e) =>
                              setMaintenanceFilters((f) => ({
                                ...f,
                                priceOp: e.target.value as "higher" | "lower",
                              }))
                            }
                            className="rounded-md border border-border-hover bg-surface-3 px-2 py-2 text-sm text-text-primary"
                          >
                            <option value="higher">Higher than</option>
                            <option value="lower">Lower than</option>
                          </select>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="e.g. 200"
                            value={maintenanceFilters.priceVal}
                            onChange={(e) => setMaintenanceFilters((f) => ({ ...f, priceVal: e.target.value }))}
                            className="flex-1 rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-text-primary0 mb-1">Mileage (km)</label>
                        <div className="flex gap-2">
                          <select
                            value={maintenanceFilters.mileageOp}
                            onChange={(e) =>
                              setMaintenanceFilters((f) => ({
                                ...f,
                                mileageOp: e.target.value as "higher" | "lower",
                              }))
                            }
                            className="rounded-md border border-border-hover bg-surface-3 px-2 py-2 text-sm text-text-primary"
                          >
                            <option value="higher">Higher than</option>
                            <option value="lower">Lower than</option>
                          </select>
                          <input
                            type="number"
                            step="1"
                            placeholder="e.g. 100000"
                            value={maintenanceFilters.mileageVal}
                            onChange={(e) => setMaintenanceFilters((f) => ({ ...f, mileageVal: e.target.value }))}
                            className="flex-1 rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border-hover bg-surface-2 overflow-hidden">
              <h2 className="text-sm font-semibold text-text-secondary px-4 py-3 border-b border-border-hover">
                Maintenance expenses ({maintenanceFilters.sortNewestFirst ? "newest first" : "oldest first"})
                {filteredMaintenanceEntries.length !== maintenanceEntries.length && (
                  <span className="font-normal text-text-primary0 ml-2">
                    ({filteredMaintenanceEntries.length} of {maintenanceEntries.length})
                  </span>
                )}
              </h2>
              {maintenanceLoading ? (
                <div className="p-8 text-center text-text-primary0">Loading…</div>
              ) : filteredMaintenanceEntries.length === 0 ? (
                <div className="p-8 text-center text-text-primary0">
                  {maintenanceEntries.length === 0
                    ? "No maintenance entries yet. Add one above."
                    : "No entries match the current filters. Adjust or clear filters."}
                </div>
              ) : (
                <div className="divide-y divide-border-hover">
                  {filteredMaintenanceEntries.map((entry) => {
                    const isEditing = editingMaintenanceId === entry.id;
                    return (
                      <div key={entry.id} className="p-4">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <input type="date" value={editMaintenanceForm.date} onChange={(e) => setEditMaintenanceForm((f) => ({ ...f, date: e.target.value }))} className="rounded border border-border-hover bg-surface-3 px-2 py-1.5 text-sm text-text-primary" />
                              <input type="number" step="0.01" value={editMaintenanceForm.price} onChange={(e) => setEditMaintenanceForm((f) => ({ ...f, price: e.target.value }))} className="rounded border border-border-hover bg-surface-3 px-2 py-1.5 text-sm text-text-primary" placeholder="Price" />
                              <input type="number" step="1" value={editMaintenanceForm.mileage} onChange={(e) => setEditMaintenanceForm((f) => ({ ...f, mileage: e.target.value }))} className="rounded border border-border-hover bg-surface-3 px-2 py-1.5 text-sm text-text-primary" placeholder="Mileage" />
                              <input
                                type="text"
                                list="maintenance-vendors-list"
                                value={editMaintenanceForm.vendor}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setEditMaintenanceForm((f) => ({ ...f, vendor: value }));
                                  void fetchMaintenanceVendors(value);
                                }}
                                className="rounded border border-border-hover bg-surface-3 px-2 py-1.5 text-sm text-text-primary"
                                placeholder="Vendor"
                              />
                            </div>
                            <textarea rows={2} value={editMaintenanceForm.description} onChange={(e) => setEditMaintenanceForm((f) => ({ ...f, description: e.target.value }))} className="w-full rounded border border-border-hover bg-surface-3 px-2 py-1.5 text-sm text-text-primary" placeholder="Description" />
                            <AddTagInput
                              tags={editMaintenanceForm.tags}
                              onTagsChange={(tags) => setEditMaintenanceForm((f) => ({ ...f, tags }))}
                              allTags={maintenanceTags}
                              fetchTags={fetchMaintenanceTags}
                              placeholder="Edit tags"
                            />
                            <div className="flex gap-2">
                              <button onClick={() => handleUpdateMaintenance(entry.id)} disabled={saving} className="text-accent-400 hover:text-accent-300 text-sm">Save</button>
                              <button onClick={() => setEditingMaintenanceId(null)} disabled={saving} className="text-text-secondary hover:text-text-primary text-sm">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-text-primary">
                                <span className="font-medium">{formatDate(entry.date)}</span> - ${Number(entry.price || 0).toFixed(2)} - {Math.round(entry.mileage || 0).toLocaleString()} km
                              </p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setEditingMaintenanceId(entry.id);
                                    setEditMaintenanceForm({
                                      date: entry.date || "",
                                      price: String(entry.price ?? ""),
                                      mileage: String(entry.mileage ?? ""),
                                      description: entry.description || "",
                                      vendor: entry.vendor || "",
                                      tags: entry.tags || [],
                                      attachments: entry.attachments || [],
                                    });
                                  }}
                                  disabled={saving}
                                  className="text-text-secondary hover:text-text-primary text-sm"
                                >
                                  Edit
                                </button>
                                <button onClick={() => handleDeleteMaintenance(entry.id)} disabled={saving} className="text-red-400 hover:text-red-300 text-sm">
                                  Delete
                                </button>
                              </div>
                            </div>
                            {entry.vendor && <p className="text-xs text-text-primary0">Vendor: {entry.vendor}</p>}
                            {entry.description && <p className="text-sm text-text-secondary">{entry.description}</p>}
                            {(entry.tags || []).length > 0 && (
                              <p className="text-xs text-text-primary0">Tags: {(entry.tags || []).join(", ")}</p>
                            )}
                            {(entry.attachments || []).length > 0 && (
                              <ul className="text-xs text-text-primary0 space-y-1">
                                {(entry.attachments || []).map((a) => (
                                  <li key={a.key}>
                                    {a.url ? (
                                      <a href={a.url} target="_blank" rel="noreferrer" className="text-accent-400 hover:text-accent-300">
                                        {a.filename || a.key}
                                      </a>
                                    ) : (
                                      a.filename || a.key
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            </>
          )}

          {activeExpenseTab === "totals" && (
            <>
              <div className="rounded-lg border border-border-hover bg-surface-3 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTotalsLimitResultsOpen((o) => !o)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-3/30 transition-colors"
                >
                  <span className="text-sm font-medium text-text-primary">Limit results</span>
                  <span className="text-text-secondary">{totalsLimitResultsOpen ? "▼" : "▶"}</span>
                </button>
                {totalsLimitResultsOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border-hover">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">Start date</label>
                        <input
                          type="date"
                          value={totalsFilters.startDate}
                          onChange={(e) => setTotalsFilters((f) => ({ ...f, startDate: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-text-primary0 mb-1">End date</label>
                        <input
                          type="date"
                          value={totalsFilters.endDate}
                          onChange={(e) => setTotalsFilters((f) => ({ ...f, endDate: e.target.value }))}
                          className="w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
                  <p className="text-xs text-text-primary0 mb-1">Fuel total</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    ${totalsSummary.fuelTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">
                    {filteredFuelEntriesForTotals.length} entries
                  </p>
                </div>
                <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
                  <p className="text-xs text-text-primary0 mb-1">Maintenance total</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    ${totalsSummary.maintenanceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">
                    {filteredMaintenanceEntriesForTotals.length} entries
                  </p>
                </div>
                <div className="rounded-lg border border-border-hover bg-surface-2 p-4">
                  <p className="text-xs text-text-primary0 mb-1">Combined total</p>
                  <p className="text-2xl font-semibold text-text-primary">
                    ${totalsSummary.combinedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">
                    Range: {totalsFilters.startDate || "All time"} - {totalsFilters.endDate || "Present"}
                  </p>
                </div>
              </div>
            </>
          )}
        </>
      ) : loading ? (
        <div className="p-8 text-center text-text-primary0">Loading vehicles…</div>
      ) : vehicles.length === 0 ? (
        <div className="rounded-lg border border-border-hover bg-surface-2 p-8 text-center text-text-primary0">
          No vehicles yet. Click &quot;+ Add vehicle&quot; to create one.
        </div>
      ) : null}
    </div>
  );
};

export default VehiclesExpensesPage;
