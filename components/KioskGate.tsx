"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { signIn } from "@/lib/auth";
import { useSettings } from "@/components/SettingsProvider";

// The lobby kiosk needs a database session of its own.
//
// It reads dogs, packages and open visits and writes sign-ins — so once the
// database stops trusting anonymous callers (see rls-lockdown.sql), the
// kiosk cannot work signed out. Leaving it anonymous would have meant
// leaving those tables open to everyone, which is the thing the lockdown
// exists to prevent.
//
// Unlike the staff gate there is NO idle re-lock: this is a wall-mounted
// iPad that must stay usable all day without anybody typing a password. Set
// it up once and the session refreshes itself.
export default function KioskGate({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    setSignedIn(!!data.session);
    setChecking(false);
  }, []);

  useEffect(() => {
    refresh();
    const { data: sub } = getSupabase().auth.onAuthStateChange(() => refresh());
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  async function submit() {
    setBusy(true);
    setError("");
    const result = await signIn(username, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not sign in.");
      return;
    }
    setPassword("");
    setSignedIn(true);
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-3">Starting up…</p>
      </div>
    );
  }

  if (signedIn) return <>{children}</>;

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-xl font-semibold text-ink">
        Set up this {settings.business.name} kiosk
      </h1>
      <p className="text-sm text-ink-3">
        Sign in once on this device. It stays signed in, so clients never see this screen — staff
        only need it when setting up a new tablet.
      </p>
      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent-500"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent-500"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-xl bg-accent-500 px-5 py-3 text-base font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Set up kiosk"}
      </button>
      {error && <p className="text-sm font-medium text-rose-500">{error}</p>}
    </div>
  );
}
