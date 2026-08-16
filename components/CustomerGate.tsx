"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import BusyButton from "@/components/BusyButton";
import PendingDetailsGate from "@/components/PendingDetailsGate";
import { useSettings } from "@/components/SettingsProvider";
import useCustomer from "@/components/useCustomer";
import { Household } from "@/lib/customer";
import { STAFF_EMAIL_DOMAIN } from "@/lib/auth";

// The sign-in every portal page sits behind.
//
// Deliberately simpler than StaffGate, and the differences are the point:
//
//   No idle lock. A client on their own phone is not an unattended screen in
//   a back office, and re-prompting them every twenty minutes would make the
//   portal something people ring up about instead of using.
//
//   No second factor. The requirements ask for MFA on Owner, Admin and
//   Manager accounts. Asking a client for an authenticator app to look at
//   their dog vaccination dates would get the portal abandoned, and it is
//   not what was asked for.
//
//   No sign-up. There is no route from this screen to a new account: an
//   account exists because staff invited a household by email. That is the
//   whole isolation argument - see the note on claiming in
//   customer-accounts-migration.sql - and a "create an account" link here
//   would quietly undo it.
export default function CustomerGate({
  children,
}: {
  children: (household: Household) => React.ReactNode;
}) {
  const { household, loading, signedIn, refresh } = useCustomer();

  if (loading) {
    return (
      <div className="mx-auto mt-24 max-w-sm px-5">
        <p className="text-sm text-ink-3">Checking…</p>
      </div>
    );
  }

  if (!signedIn) return <SignInPanel onSignedIn={refresh} />;
  if (!household) return <NoHousehold />;

  // A household that passed its meet & greet but has not sent back the rest
  // of the questionnaire gets the questionnaire and nothing else. Put here
  // rather than on each page so a screen added later cannot forget it.
  return <PendingDetailsGate>{children(household)}</PendingDetailsGate>;
}

function SignInPanel({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const { settings } = useSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentReset, setSentReset] = useState(false);

  async function submit() {
    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setBusy(false);
    if (signInError) {
      // Same wording whichever half was wrong: saying which would tell
      // somebody probing the form which email addresses are clients here.
      setError("That email and password don't match.");
      return;
    }
    setPassword("");
    await onSignedIn();
  }

  async function sendReset() {
    if (!email.trim()) {
      setError("Enter your email address first, then we can send you a link.");
      return;
    }
    setBusy(true);
    setError("");
    await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: typeof window !== "undefined" ? `${window.location.origin}/account` : undefined,
    });
    setBusy(false);
    // Shown whether or not the address is one we know, for the same reason
    // the sign-in error is vague.
    setSentReset(true);
  }

  return (
    <div className="mx-auto mt-16 flex max-w-sm flex-col gap-3 px-5 sm:mt-24">
      <h1 className="font-display text-xl font-semibold text-ink">Your account</h1>
      <p className="-mt-1 text-xs text-ink-3">
        Sign in to see {settings.business.name} records for your dogs.
      </p>

      {sentReset ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          If that address has an account with us, a link to set a new password is on its way.
        </p>
      ) : null}

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        autoComplete="email"
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
      <BusyButton busy={busy} busyLabel="Signing in…" onClick={submit} className="py-2.5">
        Sign in
      </BusyButton>
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}

      <button
        onClick={sendReset}
        disabled={busy}
        className="text-left text-xs font-medium text-accent-600 hover:underline disabled:opacity-60"
      >
        Forgotten your password?
      </button>

      <div className="mt-2 rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
        <p className="text-xs text-ink-2">
          <span className="font-medium">No account yet?</span> We set these up from our end. Ask us
          next time you are in, or give us a ring, and we will email you a link to get started.
        </p>
      </div>

      <Link href="/" className="mt-1 text-xs font-medium text-ink-3 hover:text-ink-2">
        ← Back to {settings.business.name}
      </Link>
    </div>
  );
}

/**
 * Signed in, but this account is not a client here.
 *
 * Three different situations arrive at this screen and it does not try to
 * tell them apart, because from the outside they are the same: an account
 * with no invitation ever accepted, a staff account, and an account whose
 * household an owner has since unbound. Naming which one it is would let
 * somebody use the portal to find out whether an address is a client.
 */
function NoHousehold() {
  const { settings } = useSettings();
  const [email, setEmail] = useState("");

  useEffect(() => {
    let live = true;
    getSupabase()
      .auth.getUser()
      .then(({ data }) => {
        if (live) setEmail(data.user?.email ?? "");
      });
    return () => {
      live = false;
    };
  }, []);

  const staffAccount = email.endsWith(`@${STAFF_EMAIL_DOMAIN}`);

  return (
    <div className="mx-auto mt-20 max-w-sm px-5">
      <h1 className="font-display text-xl font-semibold text-ink">Nothing here yet</h1>
      {staffAccount ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          That is a staff account. Client accounts are separate — the back office is at{" "}
          <Link href="/dashboard" className="text-accent-600 underline">
            /dashboard
          </Link>
          .
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          This account is signed in, but it is not linked to any records at {settings.business.name}{" "}
          yet. If you were sent a link to set your account up, open that link again. Otherwise give
          us a ring and we will send you a new one.
        </p>
      )}
      <button
        onClick={async () => {
          await getSupabase().auth.signOut();
          window.location.href = "/";
        }}
        className="mt-4 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-3 hover:border-rose-300 hover:text-rose-500"
      >
        ⏻ Sign out
      </button>
    </div>
  );
}
