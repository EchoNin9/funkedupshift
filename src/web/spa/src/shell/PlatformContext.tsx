import React, { createContext, useContext } from "react";
import { Capacitor } from "@capacitor/core";

interface PlatformContextValue {
  isNative: boolean;
  platform: "web" | "android" | "ios";
}

const PlatformContext = createContext<PlatformContextValue>({
  isNative: false,
  platform: "web",
});

export const PlatformProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform() as "web" | "android" | "ios";

  return (
    <PlatformContext.Provider value={{ isNative, platform }}>
      {children}
    </PlatformContext.Provider>
  );
};

export function usePlatform() {
  return useContext(PlatformContext);
}
