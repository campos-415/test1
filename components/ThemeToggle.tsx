"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isStaffRoute } from "@/lib/routes";

const KEY = "staff_theme";


const ThemeContext = createContext<{ dark: boolean; toggle: () => void; allowed: boolean }>({
  dark: false,
  toggle: () => {},
  allowed: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}

// Dark mode is a per-device staff preference, not a business setting — one
// shop can have a bright front desk and a dim back office. It lives above the
// toggle so the class is managed on every route, including ones with no
// toggle on screen.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);

  // Dark mode is for the back office only. Everything public — the website,
  // the lobby kiosk, the enrollment and booking forms — stays light whatever
  // staff picked, because those run on somebody else's screen.
  //
  // An allowlist of staff routes rather than a blocklist of public ones: the
  // marketing site will grow pages over time, and each new one would
  // otherwise have to remember to opt out of dark mode.
  //
  // Client-side navigation keeps the same document, so this also has to
  // actively REMOVE the class on the way in, not just skip adding it.
  const allowed = isStaffRoute(pathname);

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    setDark(
      stored === "dark" ||
        (stored === null && window.matchMedia?.("(prefers-color-scheme: dark)").matches)
    );
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark && allowed);
  }, [dark, allowed]);

  function toggle() {
    setDark((d) => {
      localStorage.setItem(KEY, !d ? "dark" : "light");
      return !d;
    });
  }

  return <ThemeContext.Provider value={{ dark, toggle, allowed }}>{children}</ThemeContext.Provider>;
}

export default function ThemeToggle() {
  const { dark, toggle, allowed } = useTheme();
  if (!allowed) return null;
  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light" : "Switch to dark"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2 transition hover:border-accent-400 print:hidden"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
