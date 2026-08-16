"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { signIn } from "@/lib/auth";
import { isStaffUnlocked, markStaffUnlocked } from "@/lib/staffAuth";
import MfaGate from "@/components/MfaGate";
import useRole from "@/components/useRole";
import { useSettings } from "@/components/SettingsProvider";

// The login every staff page sits behind.
//
// Three layers, doing different jobs:
//
//   Sign-in    — a real Supabase session. This is the security boundary:
//                without it the DATABASE refuses the request, not just the
//                UI. It replaces a passcode that was compared in the
//                browser against a NEXT_PUBLIC_ env var, and so shipped in
//                plain sight inside the JavaScript bundle.
//   Second     — for Owner/Admin and Manager accounts, a code from an
//   factor       authenticator app. Also a real boundary: it raises the
//                session to aal2, and the policies that guard money,
//                deletions, permissions and exports all require it.
//   Idle lock  — re-prompts after a spell with no staff page open, so an
//                unattended back-office screen does not stay open all
//                afternoon. Convenience; it does not end the session.
//
// Only the middle layer knows about roles. An account with no role can sign
// in and will find that the database refuses it everything, which is the
// correct outcome and is reported on screen rather than as a wall of
// failures.
export default function StaffGate({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  // The business this deployment belongs to, shown on the way in. A staff
  // sign-in that carries no branding could be anyone's, and this screen is
  // the first thing the front desk sees every morning.
  const { name: businessName, logoData } = useSettings().settings.business;
  const brand = (
    <div className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoData || "/logo.svg"}
        alt=""
        className="h-10 w-auto max-w-[7rem] shrink-0 object-contain"
      />
      <span className="truncate font-display text-base font-semibold text-ink">{businessName}</span>
    </div>
  );

  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { account, loading: roleLoading, unavailable: rolesUnavailable, refresh: refreshRole } = useRole();

  const refresh = useCallback(async () => {
    const { data } = await getSupabase().auth.getSession();
    const has = !!data.session;
    setSignedIn(has);
    setUnlocked(has && isStaffUnlocked());
    setChecking(false);
  }, []);

  useEffect(() => {
    refresh();
    // Signing out in one tab should lock the others.
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
    markStaffUnlocked();
    setSignedIn(true);
    setUnlocked(true);
    // The role decides whether a second factor is owed, and it belongs to
    // the account that just signed in rather than the one before it.
    await refreshRole();
  }

  if (checking) {
    return (
      <div className="mx-auto mt-28 max-w-xs px-5">
        <p className="text-sm text-ink-3">Checking…</p>
      </div>
    );
  }

  if (signedIn && unlocked) {
    // A database that has not run security-roles-migration.sql yet has no
    // roles to read. Rather than telling every member of staff they have no
    // permissions, the app behaves as it did before roles existed - and the
    // database is unchanged too, so nothing is being let through that was
    // not already.
    if (rolesUnavailable) return <>{children}</>;

    if (roleLoading) {
      return (
        <div className="mx-auto mt-28 max-w-xs px-5">
          <p className="text-sm text-ink-3">Checking…</p>
        </div>
      );
    }

    if (!account?.role) {
      return (
        <div className="mx-auto mt-24 max-w-sm px-5">
          <div className="mb-3">{brand}</div>
          <h1 className="font-display text-xl font-semibold text-ink">No access yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">
            This account is signed in but has not been given a role, so the database will refuse it
            everything. An owner can set one in Settings → Security.
          </p>
          <button
            onClick={async () => {
              const { signOut, STAFF_SIGNED_OUT_HREF } = await import("@/lib/auth");
              await signOut();
              window.location.href = STAFF_SIGNED_OUT_HREF;
            }}
            className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-3 hover:border-rose-300 hover:text-rose-500"
          >
            ⏻ Sign out
          </button>
        </div>
      );
    }

    return (
      <MfaGate account={account}>
        <>{children}</>
      </MfaGate>
    );
  }

  return (
    <div className="mx-auto mt-24 flex max-w-xs flex-col gap-3 px-5">
      {brand}
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      <p className="-mt-1 text-xs text-ink-3">
        {signedIn ? "Locked after a spell of inactivity — sign in again." : "Staff sign-in."}
      </p>

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}
