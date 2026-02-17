import React, { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import { AdminLayout } from "./AdminLayout";
import { Header } from "./Header";
import { LeftSidebar } from "./LeftSidebar";
import { getVisibleAdminModules, getVisibleModuleGroups } from "../config/modules";

/* Eager-loaded (above-the-fold) */
import HomePage from "../features/home/HomePage";
import AuthPage from "../features/auth/AuthPage";
import ProfilePage from "../features/profile/ProfilePage";

/* Lazy-loaded */
const WebsitesPage = lazy(() => import("../features/websites/WebsitesPage"));
const SiteDetailPage = lazy(() => import("../features/websites/SiteDetailPage"));
const MediaPage = lazy(() => import("../features/media/MediaPage"));
const MediaDetailPage = lazy(() => import("../features/media/MediaDetailPage"));
const DashboardPage = lazy(() => import("../features/dashboard/DashboardPage"));
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
const MemeBrowsePage = lazy(() => import("../features/memes/MemeBrowsePage"));
const MemeGeneratorPage = lazy(() => import("../features/memes/MemeGeneratorPage"));
const MemeDetailPage = lazy(() => import("../features/memes/MemeDetailPage"));
const EditMemePage = lazy(() => import("../features/memes/EditMemePage"));

function PageLoader() {
  return (
    <div className="container-max section-padding flex items-center justify-center min-h-[40vh]">
      <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

const AppLayout: React.FC = () => {
  const { user } = useAuth();
  const { siteName } = useBranding();
  const adminModules = getVisibleAdminModules(user);
  const moduleGroups = getVisibleModuleGroups(user);
  const showSidebar = user && (adminModules.length > 0 || moduleGroups.length > 0);

  React.useEffect(() => {
    if (siteName) document.title = siteName;
  }, [siteName]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <Header />
      <LeftSidebar />

      {/* Main content - add left padding when sidebar is visible */}
      <main className={`flex-1 min-w-0 ${showSidebar ? "md:pl-56" : ""}`}>
        <div className="container-max py-6">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/websites" element={<WebsitesPage />} />
              <Route path="/websites/:id" element={<SiteDetailPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/media/:id" element={<MediaDetailPage />} />
              <Route path="/internet-dashboard" element={<DashboardPage />} />
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
              <Route path="/auth" element={<AuthPage />} />
              <Route path="*" element={<div>Not found</div>} />
            </Routes>
          </Suspense>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="container-max py-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <Link to="/" className="text-lg font-display font-bold text-gradient">
                {siteName}
              </Link>
              <p className="mt-1 text-sm text-slate-500">
                Shared internet intelligence. All data public, admin-managed curation.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Navigate
              </h3>
              <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-500">
                <Link to="/" className="min-h-[44px] flex items-center hover:text-slate-300 transition-colors">
                  Home
                </Link>
                <Link to="/websites" className="min-h-[44px] flex items-center hover:text-slate-300 transition-colors">
                  Websites
                </Link>
                <Link to="/media" className="min-h-[44px] flex items-center hover:text-slate-300 transition-colors">
                  Media
                </Link>
                {user && (
                  <Link to="/profile" className="min-h-[44px] flex items-center hover:text-slate-300 transition-colors">
                    Profile
                  </Link>
                )}
              </nav>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-slate-800 text-center text-xs text-slate-600">
            &copy; {new Date().getFullYear()} {siteName}. All data public.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
