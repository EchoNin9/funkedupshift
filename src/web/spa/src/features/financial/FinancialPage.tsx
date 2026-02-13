import React from "react";
import { Link } from "react-router-dom";
import { useAuth, canAccessFinancial, canAccessFinancialAdmin } from "../../shell/AuthContext";

const FinancialPage: React.FC = () => {
  const { user } = useAuth();
  const access = canAccessFinancial(user);
  const canAdmin = canAccessFinancialAdmin(user);

  if (!access) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-slate-100">Financial</h1>
        <div className="rounded-md bg-amber-900/30 border border-amber-800/50 px-4 py-3 text-sm text-amber-200">
          You do not have access to the Financial section. Join the Financial custom group or contact an admin.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Financial</h1>

      {canAdmin && (
        <p className="text-sm text-slate-400">
          <Link to="/admin/financial" className="text-brand-orange hover:text-orange-400">
            Financial Admin
          </Link>
        </p>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
        <p className="mb-2">Financial tools coming soon:</p>
        <ul className="list-disc list-inside space-y-1 text-slate-500">
          <li>Customized stock tracker (multiple free API sources)</li>
          <li>AI-generated investment simulator</li>
        </ul>
      </div>
    </div>
  );
};

export default FinancialPage;
