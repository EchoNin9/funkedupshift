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
    <div className="sticky top-0 z-50 flex items-center justify-between gap-4 bg-amber-600 px-4 py-2 text-sm font-medium text-amber-950 shadow-md">
      <span>
        Viewing as: <strong>{displayLabel || impersonation.id}</strong>
      </span>
      <button
        type="button"
        onClick={handleStop}
        className="flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-amber-500/50"
        aria-label="Stop impersonating"
      >
        <XMarkIcon className="h-4 w-4" />
        Stop impersonating
      </button>
    </div>
  );
};

export default ImpersonationBanner;
