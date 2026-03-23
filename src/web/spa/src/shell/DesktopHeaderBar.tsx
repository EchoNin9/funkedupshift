import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";
import ImpersonationSelector from "./ImpersonationSelector";
import { UserMenu } from "./UserMenu";

export function DesktopHeaderBar() {
  const { user, isLoading, signOut } = useAuth();

  return (
    <div className="hidden md:flex items-center justify-end gap-3 px-6 py-2 border-b border-border-subtle bg-surface-0">
      {user ? (
        <>
          <ImpersonationSelector />
          <UserMenu email={user.email} onSignOut={signOut} />
        </>
      ) : isLoading ? (
        <span className="text-xs text-text-tertiary">Loading...</span>
      ) : (
        <Link to="/auth" className="btn-primary text-xs !px-3 !py-1">
          Sign in
        </Link>
      )}
    </div>
  );
}
