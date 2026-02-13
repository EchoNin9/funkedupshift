import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useAuth, canAccessFinancialAdmin } from "../../shell/AuthContext";

type TabId = "overview" | "members";

const FinancialAdminPage: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabId = tabParam === "members" ? "members" : "overview";
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  useEffect(() => {
    if (tabParam === "members") setActiveTab("members");
    else setActiveTab("overview");
  }, [tabParam]);

  const setTab = (tab: TabId) => {
    setActiveTab(tab);
    setSearchParams(tab === "overview" ? {} : { tab }, { replace: true });
  };

  const canAccess = canAccessFinancialAdmin(user);

  if (!canAccess) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Financial Admin</h1>
        <p className="text-sm text-slate-400">
          SuperAdmin or Manager with Financial group membership is required.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/financial"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Financial
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Financial Admin</h1>
        <p className="text-sm text-slate-400">
          Manage Financial section settings, members, and data sources.
        </p>
      </header>

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            activeTab === "overview" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setTab("members")}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            activeTab === "members" ? "bg-slate-800 text-slate-100" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Members
        </button>
      </div>

      {activeTab === "overview" && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
          <p className="mb-2">Admin configuration coming soon:</p>
          <ul className="list-disc list-inside space-y-1 text-slate-500">
            <li>Tracked symbols / watchlist defaults</li>
            <li>Data source selection (Alpha Vantage, Yahoo Finance, etc.)</li>
            <li>Simulator parameters</li>
          </ul>
        </div>
      )}

      {activeTab === "members" && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
          <p className="mb-2">
            Manage Financial group membership via{" "}
            <Link to="/admin/membership?tab=groups" className="text-brand-orange hover:text-orange-400">
              Membership
            </Link>
            . Create the &quot;Financial&quot; custom group and add users there.
          </p>
        </div>
      )}
    </div>
  );
};

export default FinancialAdminPage;
