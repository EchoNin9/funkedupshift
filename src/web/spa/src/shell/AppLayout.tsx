import React from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useBranding } from "./BrandingContext";
import { Header } from "./Header";
import HomePage from "../features/home/HomePage";
import WebsitesPage from "../features/websites/WebsitesPage";
import SiteDetailPage from "../features/websites/SiteDetailPage";
import MediaPage from "../features/media/MediaPage";
import MediaDetailPage from "../features/media/MediaDetailPage";
import DashboardPage from "../features/dashboard/DashboardPage";
import OurPropertiesPage from "../features/otherProperties/OurPropertiesPage";
import HighestRatedPage from "../features/otherProperties/HighestRatedPage";
import { AdminDashboard } from "../features/admin/AdminDashboard";
import BrandingPage from "../features/admin/BrandingPage";
import InternetDashboardAdminPage from "../features/admin/InternetDashboardAdminPage";
import RecommendedAdminPage from "../features/admin/RecommendedAdminPage";
import MembershipPage from "../features/admin/MembershipPage";
import WebsitesAdminPage from "../features/admin/WebsitesAdminPage";
import MediaAdminPage from "../features/admin/MediaAdminPage";
import EditSitePage from "../features/admin/EditSitePage";
import EditMediaPage from "../features/admin/EditMediaPage";
import EditUserPage from "../features/admin/EditUserPage";
import AuthPage from "../features/auth/AuthPage";
import ProfilePage from "../features/profile/ProfilePage";
import SquashPage from "../features/squash/SquashPage";
import SquashAdminPage from "../features/squash/SquashAdminPage";
import FinancialPage from "../features/financial/FinancialPage";
import FinancialAdminPage from "../features/financial/admin/FinancialAdminPage";
import MemeBrowsePage from "../features/memes/MemeBrowsePage";
import MemeGeneratorPage from "../features/memes/MemeGeneratorPage";
import MemeDetailPage from "../features/memes/MemeDetailPage";
import EditMemePage from "../features/memes/EditMemePage";

const AppLayout: React.FC = () => {
  const { user } = useAuth();
  const { siteName } = useBranding();

  React.useEffect(() => {
    if (siteName) document.title = siteName;
  }, [siteName]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      <Header />

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="container-max py-6">
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
            <Route path="/admin/financial" element={<FinancialAdminPage />} />
            <Route path="/admin/branding" element={<BrandingPage />} />
            <Route path="/admin/internet-dashboard" element={<InternetDashboardAdminPage />} />
            <Route path="/admin/recommended" element={<RecommendedAdminPage />} />
            <Route path="/admin/membership" element={<MembershipPage />} />
            <Route path="/admin/users/edit" element={<EditUserPage />} />
            <Route path="/admin/websites" element={<WebsitesAdminPage />} />
            <Route path="/admin/sites/edit/:id" element={<EditSitePage />} />
            <Route path="/admin/media" element={<MediaAdminPage />} />
            <Route path="/admin/media/edit/:id" element={<EditMediaPage />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="*" element={<div>Not found</div>} />
          </Routes>
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
              <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                <Link to="/" className="hover:text-slate-300 transition-colors">
                  Home
                </Link>
                <Link to="/websites" className="hover:text-slate-300 transition-colors">
                  Websites
                </Link>
                <Link to="/media" className="hover:text-slate-300 transition-colors">
                  Media
                </Link>
                {user && (
                  <Link to="/profile" className="hover:text-slate-300 transition-colors">
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
