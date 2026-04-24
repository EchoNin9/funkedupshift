import React, { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import { MobileBottomTabs } from "./MobileBottomTabs";
import { MobileModulesProvider } from "./MobileModulesContext";
import { AdminLayout } from "./AdminLayout";
import { pageTransition } from "../components/motion";
import { UserCircleIcon } from "@heroicons/react/24/outline";

/* Eager-loaded */
import HomePage from "../features/home/HomePage";
import AuthPage from "../features/auth/AuthPage";
import ProfilePage from "../features/profile/ProfilePage";
import MobileSettingsPage from "./MobileSettingsPage";
import MobileMorePage from "./MobileMorePage";

/* Lazy-loaded */
const WebsitesPage = lazy(() => import("../features/websites/WebsitesPage"));
const SiteDetailPage = lazy(() => import("../features/websites/SiteDetailPage"));
const MediaPage = lazy(() => import("../features/media/MediaPage"));
const MediaDetailPage = lazy(() => import("../features/media/MediaDetailPage"));
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage"));
const MyInfoPage = lazy(() => import("../features/myinfo/MyInfoPage"));
const OurPropertiesPage = lazy(() => import("../features/otherProperties/OurPropertiesPage"));
const HighestRatedPage = lazy(() => import("../features/otherProperties/HighestRatedPage"));
const AdminDashboard = lazy(() =>
  import("../features/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard }))
);
const BrandingPage = lazy(() => import("../features/admin/BrandingPage"));
const InternetDashboardAdminPage = lazy(() => import("../features/admin/InternetDashboardAdminPage"));
const RecommendedAdminPage = lazy(() => import("../features/admin/RecommendedAdminPage"));
const MembershipPage = lazy(() => import("../features/admin/MembershipPage"));
const WebsitesAdminPage = lazy(() => import("../features/admin/WebsitesAdminPage"));
const MediaAdminPage = lazy(() => import("../features/admin/MediaAdminPage"));
const EditSitePage = lazy(() => import("../features/admin/EditSitePage"));
const EditMediaPage = lazy(() => import("../features/admin/EditMediaPage"));
const EditUserPage = lazy(() => import("../features/admin/EditUserPage"));
const SquashPage = lazy(() => import("../features/squash/SquashPage"));
const SquashAdminPage = lazy(() => import("../features/squash/SquashAdminPage"));
const FinancialPage = lazy(() => import("../features/financial/FinancialPage"));
const FinancialAdminPage = lazy(() =>
  import("../features/financial/admin/FinancialAdminPage")
);
const VehiclesExpensesPage = lazy(() => import("../features/vehicles/VehiclesExpensesPage"));
const GeneralExpensesPage = lazy(() => import("../features/expenses/GeneralExpensesPage"));
const MemeBrowsePage = lazy(() => import("../features/memes/MemeBrowsePage"));
const MemeGeneratorPage = lazy(() => import("../features/memes/MemeGeneratorPage"));
const MemeDetailPage = lazy(() => import("../features/memes/MemeDetailPage"));
const EditMemePage = lazy(() => import("../features/memes/EditMemePage"));
const PrivacyPolicyPage = lazy(() => import("../features/legal/PrivacyPolicyPage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function MobileAppShell() {
  const { user } = useAuth();
  const { logo, siteName } = useBranding();
  const location = useLocation();

  return (
    <MobileModulesProvider>
      <div
        className="min-h-screen bg-surface-0 text-text-primary flex flex-col"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Compact top bar */}
        <header className="flex items-center justify-between px-4 py-2.5 bg-surface-1 border-b border-border-default">
          <Link to="/" className="flex items-center gap-2">
            {logo?.url ? (
              <img
                src={logo.url}
                alt={logo.alt || siteName}
                className="h-7 w-auto rounded object-contain"
              />
            ) : (
              <div className="h-7 w-7 rounded bg-accent-500 flex items-center justify-center text-xs font-bold text-white">
                {(siteName || "F").charAt(0)}
              </div>
            )}
            <span className="text-sm font-semibold text-text-primary">{siteName}</span>
          </Link>
          {user ? (
            <Link to="/profile" className="text-text-secondary">
              <UserCircleIcon className="w-7 h-7" />
            </Link>
          ) : (
            <Link
              to="/auth"
              className="text-xs font-medium px-3 py-1.5 rounded-md bg-accent-500 text-white"
            >
              Sign In
            </Link>
          )}
        </header>

        {/* Content area — bottom padding for tab bar */}
        <main className="flex-1 min-w-0 pb-20">
          <div className="px-4 py-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname.split("/").slice(0, 2).join("/")}
                variants={pageTransition}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                <Suspense fallback={<PageLoader />}>
                  <Routes location={location}>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/websites" element={<WebsitesPage />} />
                    <Route path="/websites/:id" element={<SiteDetailPage />} />
                    <Route path="/media" element={<MediaPage />} />
                    <Route path="/media/:id" element={<MediaDetailPage />} />
                    <Route path="/internet-dashboard" element={<DashboardPage />} />
                    <Route path="/my-info" element={<MyInfoPage />} />
                    <Route path="/recommended/highlights" element={<OurPropertiesPage />} />
                    <Route path="/recommended/highest-rated" element={<HighestRatedPage />} />
                    <Route path="/squash" element={<SquashPage />} />
                    <Route path="/squash-admin" element={<SquashAdminPage />} />
                    <Route path="/memes" element={<MemeBrowsePage />} />
                    <Route path="/memes/create" element={<MemeGeneratorPage />} />
                    <Route path="/memes/:id/edit" element={<EditMemePage />} />
                    <Route path="/memes/:id" element={<MemeDetailPage />} />
                    <Route path="/financial" element={<FinancialPage />} />
                    <Route path="/vehicles-expenses" element={<VehiclesExpensesPage />} />
                    <Route path="/general-expenses" element={<GeneralExpensesPage />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="financial" element={<FinancialAdminPage />} />
                      <Route path="branding" element={<BrandingPage />} />
                      <Route path="internet-dashboard" element={<InternetDashboardAdminPage />} />
                      <Route path="recommended" element={<RecommendedAdminPage />} />
                      <Route path="membership" element={<MembershipPage />} />
                      <Route path="users/edit" element={<EditUserPage />} />
                      <Route path="websites" element={<WebsitesAdminPage />} />
                      <Route path="sites/edit/:id" element={<EditSitePage />} />
                      <Route path="media" element={<MediaAdminPage />} />
                      <Route path="media/edit/:id" element={<EditMediaPage />} />
                      <Route path="*" element={<Navigate to="/admin" replace />} />
                    </Route>
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/more" element={<MobileMorePage />} />
                    <Route path="/mobile-settings" element={<MobileSettingsPage />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                    <Route path="*" element={<div>Not found</div>} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <MobileBottomTabs />
      </div>
    </MobileModulesProvider>
  );
}
