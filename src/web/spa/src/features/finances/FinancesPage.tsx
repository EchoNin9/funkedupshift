import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { NavLink, Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { useAuth } from "../../shell/AuthContext";
import { apiGet } from "./api";
import DashboardTab from "./DashboardTab";
import TransactionsTab from "./TransactionsTab";
import BudgetsTab from "./BudgetsTab";
import InsightsTab from "./InsightsTab";
import SharingTab from "./SharingTab";

const TABS = [
  { path: "", label: "Dashboard" },
  { path: "transactions", label: "Transactions" },
  { path: "budgets", label: "Budgets" },
  { path: "insights", label: "Insights" },
  { path: "sharing", label: "Sharing" },
];

export interface FinancesContext {
  owner: string | null; // non-null => read-only view of someone else's data
  ownerEmail: string;
  eraConnected: boolean;
  categories: string[];
}

const FinancesPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const owner = searchParams.get("owner");
  const ownerEmail = searchParams.get("ownerEmail") ?? owner ?? "";
  const [config, setConfig] = useState<{ eraConnected: boolean; categories: string[] }>({
    eraConnected: false,
    categories: [],
  });

  useEffect(() => {
    if (!user) return;
    apiGet<{ eraConnected: boolean; categories: string[] }>("/finances/config")
      .then(setConfig)
      .catch(() => {});
  }, [user]);

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">Finances</h1>
        <p className="text-sm text-text-secondary">Sign in to manage your personal finances.</p>
      </div>
    );
  }

  const ctx: FinancesContext = {
    owner: owner && owner !== user.userId ? owner : null,
    ownerEmail,
    eraConnected: config.eraConnected,
    categories: config.categories,
  };
  const ownerSuffix = ctx.owner
    ? `?owner=${encodeURIComponent(ctx.owner)}&ownerEmail=${encodeURIComponent(ownerEmail)}`
    : "";

  return (
    <div className="space-y-6">
      <motion.h1
        className="text-xl font-semibold text-text-primary"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        Finances
      </motion.h1>

      {ctx.owner && (
        <div className="rounded-md border border-accent-500 bg-surface-1 px-4 py-2 text-sm text-text-primary">
          Viewing <span className="font-medium">{ownerEmail}</span>&apos;s finances (read-only).{" "}
          <NavLink to="/finances" className="text-accent-500 hover:text-orange-400">
            Back to mine
          </NavLink>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {TABS.filter((t) => !ctx.owner || t.path !== "sharing").map((t) => (
          <NavLink
            key={t.path}
            to={`/finances${t.path ? `/${t.path}` : ""}${ownerSuffix}`}
            end={t.path === ""}
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm ${
                isActive ? "bg-accent-500 text-surface-0 font-medium" : "text-text-secondary hover:bg-surface-2"
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Routes>
        <Route index element={<DashboardTab ctx={ctx} />} />
        <Route path="transactions" element={<TransactionsTab ctx={ctx} />} />
        <Route path="budgets" element={<BudgetsTab ctx={ctx} />} />
        <Route path="insights" element={<InsightsTab ctx={ctx} />} />
        <Route path="sharing" element={<SharingTab ctx={ctx} />} />
        <Route path="*" element={<Navigate to="/finances" replace />} />
      </Routes>
    </div>
  );
};

export default FinancesPage;
