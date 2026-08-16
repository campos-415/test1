"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import BusyButton from "@/components/BusyButton";
import { useSettings } from "@/components/SettingsProvider";
import { claimInvite, forgetCachedHousehold } from "@/lib/customer";

// Setting up an account, from the link in the email.
//
// This is the ONLY way an account ever becomes attached to a household. It
// is reached by opening a link that was emailed to the address already on
// file, which is what makes holding the link proof of controlling that
// address. There is deliberately no version of this screen that takes a
// phone number: guessing a phone number is trivial, and a portal that hands
// over a household for a correct guess is precisely the isolation failure
// the requirements are about.
//
// The token is checked by claim_owner_invite in the database, not here. This
// screen only gets a session for the person and then hands the token over.
export default function ClaimPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ? decodeURIComponent(params.token) : "";
  const router = useRouter();
  const { settings } = useSettings();

  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Already signed in — either they came back to the link, or they just set
  // a password and Supabase handed back a session. Either way the only thing
  // left is to hand the token over.
  const finish = useCallback(async () => {
    const result = await claimInvite(token);
    if (!result.ok) {
      setError(result.error ?? "That invitation could not be used.");
      setChecking(false);
      return false;
    }
    forgetCachedHousehold();
    router.replace("/account");
    return true;
  }, [token, router]);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (!live) return;
      if (data.session) {
        await finish();
        return;
      }
      setChecking(false);
    })();
    return () => {
      live = false;
    };
  }, [finish]);

  // Choosing a password is the whole of what this asks.
  //
  // There is no email field, and that is a security property rather than a
  // tidier form. The address comes off the owner record on the server - see
  // app/api/claim/route.ts - so an account can never be created under an
  // address the business does not already hold, and the person opening the
  // link cannot substitute their own.
  async function createAccount() {
    if (password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        signInInstead?: boolean;
        signInYourself?: boolean;
        access_token?: string;
        refresh_token?: string;
      };

      if (!res.ok || !body.ok) {
        setBusy(false);
        setError(body.error ?? "We could not set that up just now.");
        // They already have an account, so the password box becomes a
        // sign-in box rather than a dead end.
        if (body.signInInstead) setMode("signin");
        return;
      }

      if (body.access_token && body.refresh_token) {
        await getSupabase().auth.setSession({
          access_token: body.access_token,
          refresh_token: body.refresh_token,
        });
        forgetCachedHousehold();
        router.replace("/account");
        return;
      }

      // Account made and household bound, but the session did not come
      // back. Nothing is broken; they just sign in.
      setBusy(false);
      setMode("signin");
      setError("Your account is ready — sign in with the password you just chose.");
    } catch (e) {
      console.error("Setting the account up failed:", e);
      setBusy(false);
      setError("We could not reach the server. Check your connection and try again.");
    }
  }

  async function signIn() {
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
    if (signInError) {
      setBusy(false);
      setError("That email and password don't match.");
      return;
    }
    await finish();
    setBusy(false);
  }

  if (checking) {
    return (
      <div className="mx-auto mt-20 max-w-sm px-1">
        <p className="text-sm text-ink-3">Setting your account up…</p>
      </div>
    );
  }

  // There is no "check your email to confirm" step any more. The invitation
  // reaching them WAS the confirmation - it only arrived at the address on
  // file - so the server marks the address confirmed when it creates the
  // account, and they go straight in.
  return (
    <div className="mx-auto mt-10 flex max-w-sm flex-col gap-3 px-1 sm:mt-16">
      <h1 className="font-display text-xl font-semibold text-ink">
        {mode === "create" ? "Set up your account" : "Sign in to finish"}
      </h1>
      <p className="-mt-1 text-xs text-ink-3">
        {mode === "create"
          ? `Choose a password and you will be able to see your dogs' records with ${settings.business.name}.`
          : "Sign in and we will link this invitation to your account."}
      </p>

      {mode === "create" ? (
        // No email field, on purpose. We already know the address — this
        // link was sent to it — and letting somebody type a different one is
        // how an account ends up under an address we do not hold.
        <p className="rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3 text-xs text-ink-2">
          Your account will use the email address we already have for you — the one this link was
          sent to. If that is the wrong address, give us a ring and we will change it before you
          set up.
        </p>
      ) : (
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
      )}
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "create" ? "Choose a password" : "Password"}
        autoComplete={mode === "create" ? "new-password" : "current-password"}
        onKeyDown={(e) => e.key === "Enter" && (mode === "create" ? createAccount() : signIn())}
        className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />
      {mode === "create" && (
        <p className="-mt-1 text-[11px] text-ink-3">At least 8 characters.</p>
      )}

      <BusyButton
        busy={busy}
        busyLabel={mode === "create" ? "Setting your account up…" : "Signing in…"}
        onClick={mode === "create" ? createAccount : signIn}
        className="py-2.5"
      >
        {mode === "create" ? "Create my account" : "Sign in"}
      </BusyButton>
      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}

      <button
        onClick={() => {
          setMode((m) => (m === "create" ? "signin" : "create"));
          setError("");
        }}
        className="text-left text-xs font-medium text-accent-600 hover:underline"
      >
        {mode === "create" ? "I already have an account" : "I need to set a password"}
      </button>

      <Link href="/" className="mt-1 text-xs font-medium text-ink-3 hover:text-ink-2">
        ← {settings.business.name}
      </Link>
    </div>
  );
}
