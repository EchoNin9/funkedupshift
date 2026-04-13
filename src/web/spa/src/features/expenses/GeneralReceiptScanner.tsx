import React, { useState } from "react";
import { CameraIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import { CameraSource } from "@capacitor/camera";
import { takePhoto, base64ToBlob } from "../../hooks/useCamera";
import { fetchWithAuth } from "../../utils/api";

interface GeneralScannedFields {
  date: string | null;
  price: number | null;
  vendor: string | null;
  description: string | null;
}

interface GeneralReceiptScannerProps {
  apiBase: string;
  onFieldsExtracted: (fields: GeneralScannedFields) => void;
  onClose: () => void;
}

type ScanState = "idle" | "capturing" | "uploading" | "scanning" | "review" | "error";

export default function GeneralReceiptScanner({ apiBase, onFieldsExtracted, onClose }: GeneralReceiptScannerProps) {
  const [state, setState] = useState<ScanState>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable draft — user can correct before applying
  const [draft, setDraft] = useState<{
    date: string;
    price: string;
    vendor: string;
    description: string;
  }>({ date: "", price: "", vendor: "", description: "" });

  const handleCapture = async () => {
    setState("capturing");
    setError(null);
    try {
      const photo = await takePhoto(CameraSource.Camera);
      if (!photo.base64String) {
        setState("idle");
        return;
      }

      const mimeType = `image/${photo.format || "jpeg"}`;
      setPreview(`data:${mimeType};base64,${photo.base64String}`);

      // Step 1: presigned upload URL
      setState("uploading");
      let uploadUrl: string;
      let key: string;
      try {
        const urlResp = await fetchWithAuth(`${apiBase}/general-expenses/receipt-upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: mimeType }),
        });
        if (!urlResp.ok) {
          const d = await urlResp.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error || `Server error ${urlResp.status}`);
        }
        ({ uploadUrl, key } = (await urlResp.json()) as { uploadUrl: string; key: string });
      } catch (e: any) {
        throw new Error(`Could not get upload URL: ${e.message}`);
      }

      // Step 2: PUT image to S3
      try {
        const blob = base64ToBlob(photo.base64String, mimeType);
        const putResp = await fetch(uploadUrl, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": mimeType },
        });
        if (!putResp.ok) throw new Error(`S3 responded ${putResp.status}`);
      } catch (e: any) {
        throw new Error(`Image upload failed: ${e.message}`);
      }

      // Step 3: scan
      setState("scanning");
      try {
        const scanResp = await fetchWithAuth(`${apiBase}/general-expenses/scan-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageKey: key }),
        });
        if (!scanResp.ok) {
          const d = await scanResp.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error || `Server error ${scanResp.status}`);
        }
        const result = (await scanResp.json()) as GeneralScannedFields;
        setDraft({
          date: result.date || new Date().toISOString().slice(0, 10),
          price: result.price != null ? String(result.price) : "",
          vendor: result.vendor || "",
          description: result.description || "",
        });
        setState("review");
      } catch (e: any) {
        throw new Error(`Receipt scan failed: ${e.message}`);
      }
    } catch (e: any) {
      if (e?.message === "User cancelled photos app") {
        setState("idle");
        return;
      }
      setError(e?.message || "Unknown error");
      setState("error");
    }
  };

  const handleApply = () => {
    onFieldsExtracted({
      date: draft.date || null,
      price: draft.price ? parseFloat(draft.price) || null : null,
      vendor: draft.vendor.trim() || null,
      description: draft.description.trim() || null,
    });
    onClose();
  };

  const inputClass =
    "w-full rounded-md border border-border-hover bg-surface-3 px-3 py-2 text-sm text-text-primary placeholder-text-tertiary";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-full max-w-lg bg-surface-1 rounded-t-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Scan Receipt</h2>
          <button onClick={onClose} className="p-1 text-text-tertiary hover:text-text-primary">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Idle */}
        {state === "idle" && (
          <div className="text-center space-y-3 py-2">
            <p className="text-sm text-text-secondary">
              Take a photo of your receipt to auto-fill the form. You can edit the extracted values before saving.
            </p>
            <button
              onClick={handleCapture}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white"
            >
              <CameraIcon className="w-5 h-5" />
              Take Photo
            </button>
          </div>
        )}

        {/* Processing */}
        {(state === "capturing" || state === "uploading" || state === "scanning") && (
          <div className="text-center space-y-4 py-4">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-40 rounded-lg object-contain" />
            )}
            <div className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-text-secondary">
                {state === "capturing" && "Opening camera\u2026"}
                {state === "uploading" && "Uploading receipt\u2026"}
                {state === "scanning" && "Scanning receipt\u2026"}
              </span>
            </div>
          </div>
        )}

        {/* Review — editable fields */}
        {state === "review" && (
          <div className="space-y-3">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-20 rounded-lg object-contain" />
            )}
            <p className="text-xs text-text-tertiary">
              Review and correct the extracted values before applying.
            </p>

            <div className="space-y-2">
              <div>
                <label className="block text-xs text-text-secondary mb-1">Date</label>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Price ($)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Vendor</label>
                <input
                  type="text"
                  value={draft.vendor}
                  onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))}
                  placeholder="Store or vendor name"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1">Description</label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Items purchased"
                  rows={2}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleApply}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <CheckIcon className="w-4 h-4" />
                Apply to Form
              </button>
              <button
                onClick={handleCapture}
                className="rounded-lg border border-border-hover px-4 py-2.5 text-sm font-medium text-text-primary"
              >
                Retake
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div className="space-y-4 py-4">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-28 rounded-lg object-contain" />
            )}
            <p className="text-sm text-red-400 text-center">{error}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={handleCapture}
                className="rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="rounded-lg border border-border-hover px-4 py-2.5 text-sm font-medium text-text-primary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
