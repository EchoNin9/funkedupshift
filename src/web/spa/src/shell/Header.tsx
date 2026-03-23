import React from "react";
import { MobileHeader } from "./MobileHeader";
import { DesktopHeaderBar } from "./DesktopHeaderBar";
import ImpersonationBanner from "./ImpersonationBanner";

export function Header() {
  return (
    <>
      {/* Desktop: impersonation banner spans full width */}
      <div className="hidden md:block">
        <ImpersonationBanner />
      </div>

      {/* Mobile header with slide-out nav */}
      <MobileHeader />
    </>
  );
}
