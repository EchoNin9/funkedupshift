import React, { useState } from "react";
import { CameraIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import { CameraSource } from "@capacitor/camera";
import { takePhoto, base64ToBlob } from "../../hooks/useCamera";
import { fetchWithAuth } from "../../utils/api";

interface ScannedFields {
  date: string | null;
  fuelPrice: number | null;
  fuelLitres: number | null;
  odometerKm: number | null;
  _debug?: {
    expenseText?: string;
    queryAnswers?: Record<string, string>;
    rawLines?: string[];
  };
}

interface ReceiptScannerProps {
  apiBase: string;
  onFieldsExtracted: (fields: ScannedFields) => void;
  onClose: () => void;
}

type ScanState = "idle" | "capturing" | "uploading" | "scanning" | "done" | "error";

export default function ReceiptScanner({ apiBase, onFieldsExtracted, onClose }: ReceiptScannerProps) {
  const [state, setState] = useState<ScanState>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [fields, setFields] = useState<ScannedFields | null>(null);
  const [error, setError] = useState<string | null>(null);

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

      // Step 1: get a presigned S3 upload URL
      setState("uploading");
      let uploadUrl: string;
      let key: string;
      try {
        const urlResp = await fetchWithAuth(`${apiBase}/vehicles-expenses/receipt-upload`, {
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

      // Step 2: PUT the image to S3
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

      // Step 3: ask the API to scan the receipt
      setState("scanning");
      try {
        const scanResp = await fetchWithAuth(`${apiBase}/vehicles-expenses/scan-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageKey: key }),
        });
        if (!scanResp.ok) {
          const d = await scanResp.json().catch(() => ({}));
          throw new Error((d as { error?: string }).error || `Server error ${scanResp.status}`);
        }
        const result = (await scanResp.json()) as ScannedFields;
        setFields(result);
        setState("done");
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

  const handleUseValues = () => {
    if (fields) {
      onFieldsExtracted(fields);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
         style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="w-full max-w-lg bg-surface-1 rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">Scan Fuel Receipt</h2>
          <button onClick={onClose} className="p-1 text-text-tertiary">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {state === "idle" && (
          <div className="text-center space-y-4 py-6">
            <p className="text-sm text-text-secondary">
              Take a photo of your fuel receipt to auto-fill the form.
            </p>
            <button
              onClick={handleCapture}
              className="inline-flex items-center gap-2 rounded-lg bg-accent-500 px-6 py-3 text-sm font-semibold text-white"
            >
              <CameraIcon className="w-5 h-5" />
              Take Photo
            </button>
          </div>
        )}

        {(state === "uploading" || state === "scanning" || state === "capturing") && (
          <div className="text-center space-y-4 py-6">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-48 rounded-lg object-contain" />
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

        {state === "done" && fields && (
          <div className="space-y-4">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-32 rounded-lg object-contain" />
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-text-secondary">Extracted Fields</h3>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Date" value={fields.date} />
                <Field label="Fuel Price" value={fields.fuelPrice != null ? `$${fields.fuelPrice}` : null} />
                <Field label="Fuel Litres" value={fields.fuelLitres != null ? `${fields.fuelLitres} L` : null} />
                <Field label="Odometer" value={fields.odometerKm != null ? `${fields.odometerKm} km` : null} />
              </div>
            </div>
            {/* Debug: show what Textract actually read (temporary) */}
            {fields._debug && (fields.fuelLitres == null || fields.odometerKm == null) && (
              <details className="rounded-lg bg-surface-2 p-3 text-xs text-text-tertiary">
                <summary className="cursor-pointer font-medium text-text-secondary">
                  Textract debug info (some fields not found)
                </summary>
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                  {fields._debug.queryAnswers && Object.keys(fields._debug.queryAnswers).length > 0 && (
                    <div>
                      <p className="font-medium">Query answers:</p>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(fields._debug.queryAnswers, null, 2)}</pre>
                    </div>
                  )}
                  {fields._debug.rawLines && fields._debug.rawLines.length > 0 && (
                    <div>
                      <p className="font-medium">Raw text lines:</p>
                      <pre className="whitespace-pre-wrap">{fields._debug.rawLines.join("\n")}</pre>
                    </div>
                  )}
                </div>
              </details>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleUseValues}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent-500 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <CheckIcon className="w-4 h-4" />
                Use Values
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

        {state === "error" && (
          <div className="space-y-4 py-4">
            {preview && (
              <img src={preview} alt="Receipt" className="mx-auto max-h-32 rounded-lg object-contain" />
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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`text-sm font-medium ${value ? "text-text-primary" : "text-text-tertiary"}`}>
        {value || "Not found"}
      </div>
    </div>
  );
}
