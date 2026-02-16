import React from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useImpersonation } from "./ImpersonationContext";
import { useAuth } from "./AuthContext";

const ImpersonationBanner: React.FC = () => {
  const { impersonation, clearImpersonation } = useImpersonation();
  const { user, refreshAuth } = useAuth();

  if (!impersonation) return null;

  const displayLabel = user?.impersonated ? (user.impersonatedAs || user.email) : impersonation.label;

  const handleStop = () => {
    clearImpersonation();
    refreshAuth();
  };

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 bg-amber-600 px-4 py-2 text-sm font-medium text-amber-950 shadow-md">
      <span className="min-w-0 truncate">
        Viewing as: <strong>{displayLabel || impersonation.id}</strong>
      </span>
      <button
        type="button"
        onClick={handleStop}
        className="flex items-center gap-1.5 min-h-[44px] min-w-[44px] sm:min-w-0 rounded-md px-3 py-2 font-semibold hover:bg-amber-500/50 shrink-0"
        aria-label="Stop impersonating"
      >
        <XMarkIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Stop impersonating</span>
      </button>
    </div>
  );
};

export default ImpersonationBanner;
