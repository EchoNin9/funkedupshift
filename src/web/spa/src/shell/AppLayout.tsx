import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import { useAuth, hasRole, canAccessSquash, canModifySquash, canAccessFinancial, canAccessFinancialAdmin, canAccessMemes } from "./AuthContext";
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
            <Route path="/admin/*" element={<div>Admin area</div>} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="*" element={<div>Not found</div>} />
          </Routes>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950">
        <div className="container-max py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <nav className="flex flex-wrap gap-3 justify-center sm:justify-start">
            <Link to="/" className="hover:text-slate-300">
              Home
            </Link>
            <Link to="/websites" className="hover:text-slate-300">
              Websites
            </Link>
            <Link to="/media" className="hover:text-slate-300">
              Media
            </Link>
            <Link to="/internet-dashboard" className="hover:text-slate-300">
              Internet dashboard
            </Link>
            <Link to="/recommended/highlights" className="hover:text-slate-300">
              Highlights
            </Link>
            <Link to="/recommended/highest-rated" className="hover:text-slate-300">
              Highest rated
            </Link>
            {user && (
              <Link to="/profile" className="hover:text-slate-300">
                Profile
              </Link>
            )}
            {hasRole(user ?? null, "superadmin") && (
              <Link to="/admin/branding" className="hover:text-slate-300">
                Branding
              </Link>
            )}
            {canAccessSquash(user) && (
              <Link to="/squash" className="hover:text-slate-300">
                Squash
              </Link>
            )}
            {canModifySquash(user) && (
              <Link to="/squash-admin" className="hover:text-slate-300">
                Squash Admin
              </Link>
            )}
            {(!user || canAccessMemes(user)) && (
              <Link to="/memes" className="hover:text-slate-300">
                Memes
              </Link>
            )}
            {canAccessFinancial(user) && (
              <Link to="/financial" className="hover:text-slate-300">
                Financial
              </Link>
            )}
            {canAccessFinancialAdmin(user) && (
              <Link to="/admin/financial" className="hover:text-slate-300">
                Financial Admin
              </Link>
            )}
          </nav>
          <div className="text-slate-600">
            <span className="font-mono text-[11px]">{siteName.toLowerCase().replace(/\s+/g, "")}</span>{" "}
            <span className="text-slate-700">·</span> <span>All data public, admin-managed curation</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default AppLayout;
