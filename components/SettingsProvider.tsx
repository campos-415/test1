"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isAppRoute } from "@/lib/routes";
import { AppSettings, DEFAULT_SETTINGS, getSettings, loadSettings } from "@/lib/settings";
import { applyTheme } from "@/lib/theme";

const SettingsContext = createContext<{ settings: AppSettings; refresh: () => Promise<void> }>({
  settings: DEFAULT_SETTINGS,
  refresh: async () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

// Loads the settings row once at startup and hydrates the module cache the
// pricing getters read from. Children render immediately against the
// shipped defaults rather than blocking on the network — the kiosk should
// come up even if Supabase is slow — and re-render once the real values
// land.
export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<AppSettings>(getSettings());

  async function refresh() {
    setSettings(await loadSettings());
  }

  useEffect(() => {
    refresh();
  }, []);

  // Paint the brand and print colours onto <html>, and put the business name
  // in the tab title. Both used to be baked in at build time, which is what
  // made the app one-business-only.
  useEffect(() => {
    applyTheme(settings.business.accentColor, settings.business.printColor);
    // Only on the app. The marketing pages set their own titles through
    // Next metadata, and overwriting those would cost real SEO — every page
    // would report itself as the sign-in screen.
    if (settings.business.name && isAppRoute(pathname)) {
      document.title = `${settings.business.name} — sign in`;
    }
  }, [
    settings.business.accentColor,
    settings.business.printColor,
    settings.business.name,
    pathname,
  ]);

  return (
    <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>
  );
}
