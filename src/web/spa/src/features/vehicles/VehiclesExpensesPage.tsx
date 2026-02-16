import React, { useCallback, useEffect, useState, useRef } from "react";
import { useAuth, canAccessExpenses } from "../../shell/AuthContext";
import { fetchWithAuth } from "../../utils/api";
import { AdminTabs } from "../admin/AdminTabs";

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
  fuelLitres?: number;
  odometerKm?: number;
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

function calcFuelMetrics(
  entry: FuelEntry,
  prevEntry: FuelEntry | null
): { pricePerLitre: number | null; distanceKm: number; lPer100km: number | null; mpg: number | null } {
  const price = entry.fuelPrice ?? 0;
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
  const [loading, setLoading] = useState(true);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  const [renamingVehicleId, setRenamingVehicleId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  useEffect(() => {
    if (canAccess) loadVehicles();
    else setLoading(false);
  }, [canAccess, loadVehicles]);

  useEffect(() => {
    if (selectedVehicleId) loadFuelEntries(selectedVehicleId);
    else setFuelEntries([]);
  }, [selectedVehicleId, loadFuelEntries]);

  useEffect(() => {
    if (renamingVehicleId && renamingVehicleId !== selectedVehicleId) {
      setRenamingVehicleId(null);
      setRenameValue("");
    }
  }, [selectedVehicleId, renamingVehicleId]);

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
      loadFuelEntries(selectedVehicleId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
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
      for (let i = 0; i < headerRow.length; i++) {
        const h = String(headerRow[i] ?? "").toLowerCase().trim();
        if (!h) continue;
        if (h.includes("date")) colMap.date = i;
        else if (h.includes("litre") || h.includes("liter") || h.includes("volume")) colMap.fuelLitres = i;
        else if (h.includes("price") || h.includes("cost") || (h.includes("fuel") && !h.includes("litre"))) colMap.fuelPrice = i;
        else if (h.includes("odometer") || h.includes("mileage") || (h.includes("km") && !h.includes("l/100"))) colMap.odometerKm = i;
        else if (h.includes("vehicle")) colMap.vehicle = i;
      }
      const dateCol = colMap.date ?? 0;
      const priceCol = colMap.fuelPrice ?? 1;
      const litresCol = colMap.fuelLitres ?? 2;
      const odoCol = colMap.odometerKm ?? 3;
      const vehicleCol = colMap.vehicle ?? 4;
      const byVehicle: Record<string, { date: string; fuelPrice: number; fuelLitres: number; odometerKm: number }[]> = {};
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] as (string | number)[];
        if (!Array.isArray(row)) continue;
        const dateVal = row[dateCol];
        const priceVal = row[priceCol];
        const litresVal = row[litresCol];
        const odoVal = row[odoCol];
        const vehicleVal = row[vehicleCol];
        if (dateVal == null && priceVal == null && litresVal == null && odoVal == null) continue;
        if (dateVal === "" && priceVal === "" && litresVal === "" && odoVal === "") continue;
        let dateStr = "";
        if (typeof dateVal === "number" && !isNaN(dateVal) && dateVal > 0) {
          const d = new Date((dateVal - excelEpoch) * 86400 * 1000);
          dateStr = d.toISOString().slice(0, 10);
        } else {
          dateStr = String(dateVal ?? "").trim().slice(0, 10);
        }
        const price = typeof priceVal === "number" && !isNaN(priceVal) ? priceVal : parseFloat(String(priceVal ?? "").replace(/,/g, "")) || 0;
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
        <h1 className="text-2xl font-display font-bold text-slate-100">Vehicles Expenses</h1>
        <p className="text-slate-400">Sign in to access your vehicle expenses.</p>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-display font-bold text-slate-100">Vehicles Expenses</h1>
        <p className="text-slate-400">
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
          <h1 className="text-2xl font-display font-bold text-slate-100">Vehicles Expenses</h1>
          <p className="text-slate-400 mt-1">Track fuel costs per vehicle. Data is private to you.</p>
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
            className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            {importing ? "Importing…" : "Import from CSV/Excel"}
          </button>
          <button
            type="button"
            onClick={() => setShowImportHelp((v) => !v)}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {showImportHelp ? "Hide format" : "Import format"}
          </button>
        </div>
      </div>

      {showImportHelp && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-300 space-y-2">
          <p className="font-medium text-slate-200">CSV / Excel import format</p>
          <p>Use columns: <strong>Date</strong> (YYYY-MM-DD), <strong>Fuel Price</strong> ($), <strong>Fuel Litres</strong>, <strong>Odometer (km)</strong>, <strong>Vehicle</strong>. First row = headers. CSV or Excel (.xlsx, .xls) supported.</p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {importMessage && (
        <div className="rounded-md border border-green-500/60 bg-green-500/10 px-3 py-2 text-sm text-green-200">
          {importMessage}
        </div>
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
          }
        }}
      />

      {showAddVehicle ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Add vehicle</h2>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Vehicle name"
              value={newVehicleName}
              onChange={(e) => setNewVehicleName(e.target.value)}
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 flex-1"
            />
            <button
              onClick={handleAddVehicle}
              disabled={saving || !newVehicleName.trim()}
              className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      ) : selectedVehicleId ? (
        <>
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
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
                      className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-slate-100 placeholder-slate-500 w-48"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenameVehicle(selectedVehicleId, renameValue)}
                      disabled={saving || !renameValue.trim()}
                      className="text-sm text-primary-400 hover:text-primary-300"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setRenamingVehicleId(null);
                        setRenameValue("");
                      }}
                      className="text-sm text-slate-400 hover:text-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="text-sm font-semibold text-slate-300">
                      {vehicles.find((v) => v.id === selectedVehicleId)?.name || "Vehicle"}
                    </h2>
                    <button
                      onClick={() => {
                        setRenamingVehicleId(selectedVehicleId);
                        setRenameValue(vehicles.find((v) => v.id === selectedVehicleId)?.name || "");
                      }}
                      disabled={saving}
                      className="text-xs text-slate-400 hover:text-slate-200"
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
            <h2 className="text-sm font-semibold text-slate-300 mb-3">Add fuel expense</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="date"
                value={fuelForm.date}
                onChange={(e) => setFuelForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Fuel price ($)"
                value={fuelForm.fuelPrice}
                onChange={(e) => setFuelForm((f) => ({ ...f, fuelPrice: e.target.value }))}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500"
              />
              <input
                type="number"
                step="0.001"
                placeholder="Fuel litres"
                value={fuelForm.fuelLitres}
                onChange={(e) => setFuelForm((f) => ({ ...f, fuelLitres: e.target.value }))}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500"
              />
              <input
                type="number"
                step="1"
                placeholder="Odometer (km)"
                value={fuelForm.odometerKm}
                onChange={(e) => setFuelForm((f) => ({ ...f, odometerKm: e.target.value }))}
                className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500"
              />
            </div>
            <button
              onClick={handleAddFuel}
              disabled={saving || !fuelForm.fuelPrice || !fuelForm.fuelLitres || !fuelForm.odometerKm}
              className="mt-3 rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add fuel entry"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
            <h2 className="text-sm font-semibold text-slate-300 px-4 py-3 border-b border-slate-700">
              Fuel expenses (newest first)
            </h2>
            {fuelLoading ? (
              <div className="p-8 text-center text-slate-500">Loading…</div>
            ) : fuelEntries.length === 0 ? (
              <div className="p-8 text-center text-slate-500">No fuel entries yet. Add one above.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-700">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Fuel price</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Volume</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">$/L</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">L/100km</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">MPG</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Odometer</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Distance</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {fuelEntries.map((entry, idx) => {
                      const prev = fuelEntries[idx + 1] ?? null;
                      const { pricePerLitre, distanceKm, lPer100km, mpg } = calcFuelMetrics(entry, prev);
                      return (
                        <tr key={entry.id} className="hover:bg-slate-800/50">
                          <td className="px-4 py-3 text-sm text-slate-200">{formatDate(entry.date)}</td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            ${(entry.fuelPrice ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {(entry.fuelLitres ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3 })}L
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {pricePerLitre != null
                              ? `$${pricePerLitre.toLocaleString(undefined, { minimumFractionDigits: 4 })}/L`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {lPer100km != null ? lPer100km.toFixed(2) : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {mpg != null ? mpg.toFixed(1) : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {(entry.odometerKm ?? 0).toLocaleString()} km
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-slate-300">
                            {distanceKm > 0 ? `${distanceKm.toLocaleString()} km` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => handleDeleteFuel(entry.id)}
                              disabled={saving}
                              className="text-red-400 hover:text-red-300 text-sm"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : loading ? (
        <div className="p-8 text-center text-slate-500">Loading vehicles…</div>
      ) : vehicles.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-8 text-center text-slate-500">
          No vehicles yet. Click &quot;+ Add vehicle&quot; to create one.
        </div>
      ) : null}
    </div>
  );
};

export default VehiclesExpensesPage;
