import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircleIcon } from "@heroicons/react/24/outline";

function getApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as { API_BASE_URL?: string }).API_BASE_URL;
  return raw ? raw.replace(/\/$/, "") : null;
}

const MerchSuccessPage: React.FC = () => {
  const [params] = useSearchParams();
  const sessionId = params.get("session_id") || "";
  const [status, setStatus] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const base = getApiBaseUrl();
    if (!base) {
      setErr("API URL not set.");
      return;
    }
    (async () => {
      try {
        const r = await fetch(
          `${base}/merch/order-status?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setErr((data as { error?: string }).error || "Could not load order.");
          return;
        }
        setStatus((data as { status?: string }).status || null);
        setFulfillment((data as { fulfillmentStatus?: string }).fulfillmentStatus || null);
      } catch {
        setErr("Could not load order.");
      }
    })();
  }, [sessionId]);

  return (
    <div className="max-w-lg mx-auto text-center space-y-6 py-8">
      <CheckCircleIcon className="h-16 w-16 text-emerald-500 mx-auto" aria-hidden />
      <h1 className="text-2xl font-bold text-text-primary">Thank you!</h1>
      <p className="text-text-secondary text-sm">
        Your payment was received. You will get a confirmation email from Stripe. Print-on-demand orders are
        submitted to Gelato automatically when configured.
      </p>
      {sessionId && (
        <div className="rounded-lg border border-border-default bg-surface-1 p-4 text-left text-sm space-y-1">
          <p className="text-text-tertiary text-xs uppercase tracking-wide">Order</p>
          {err && <p className="text-red-400">{err}</p>}
          {!err && status && (
            <>
              <p className="text-text-primary">
                Status: <span className="font-medium">{status}</span>
              </p>
              {fulfillment && (
                <p className="text-text-secondary">
                  Fulfillment: <span className="font-medium">{fulfillment}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}
      <Link to="/merch" className="inline-block btn-primary px-5 py-2">
        Back to store
      </Link>
      <div>
        <Link to="/merch/support" className="text-sm text-accent-400 hover:text-accent-300">
          Help &amp; returns
        </Link>
      </div>
    </div>
  );
};

export default MerchSuccessPage;
