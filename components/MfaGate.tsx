"use client";

import { useCallback, useEffect, useState } from "react";
import MfaSetup from "@/components/MfaSetup";
import { MfaFactor, assuranceLevel, verifiedFactor, verifyCode } from "@/lib/mfa";
import { logMfaVerified } from "@/lib/audit";
import { StaffAccount, ROLE_LABELS, mfaRequiredFor } from "@/lib/roles";

// The second factor, for the accounts the requirements document says need
// one: Owner/Admin and Manager.
//
// The governing rule, and it is worth stating before the states: NOBODY WHO
// HAS NOT ENROLLED IS EVER BLOCKED BY THIS SCREEN. Being unable to sign in to
// a working application because of a security feature that has not been set
// up yet is a worse failure than not having the feature. So enforcement is
// something an owner switches on per account, and until it is switched on
// this is a prompt rather than a wall.
//
// Four states:
//
//   Owed        an authenticator is set up and this session has not used it.
//               A code is required, and this one does block - but it can
//               always be completed, because the account that enrolled has
//               the app in its hand. The database agrees: at aal1 every
//               manager capability is refused, so waving it through would
//               produce an application where nothing works rather than one
//               with the locks off.
//   Offered     the account could use MFA and has not set it up, and nobody
//               has required it. A dismissible banner, and the app is fully
//               usable behind it.
//   Required    an owner has switched enforcement on for this account and it
//               still has no authenticator. This blocks, because somebody
//               chose it deliberately. security-rollback.sql has the
//               break-glass for a lost phone.
//   Satisfied   nothing to do.
//
// Employees and the lobby kiosk never see any of this.

type Stage = "checking" | "challenge" | "offer" | "require" | "satisfied";

export default function MfaGate({
  account,
  children,
}: {
  account: StaffAccount;
  children: React.ReactNode;
}) {
  const [stage, setStage] = useState<Stage>("checking");
  const [factor, setFactor] = useState<MfaFactor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Dismissing lasts for this page and the reminder comes back on the next
  // one. Persisting it would turn a reminder into something somebody
  // switches off once and never sees again.
  const [deferred, setDeferred] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const assess = useCallback(async () => {
    if (!mfaRequiredFor(account.role)) {
      setStage("satisfied");
      return;
    }
    try {
      const [level, verified] = await Promise.all([assuranceLevel(), verifiedFactor()]);
      setFactor(verified);
      if (verified) {
        setStage(level.current === "aal2" ? "satisfied" : "challenge");
      } else {
        // No authenticator. Blocking only where an owner asked for it.
        setStage(account.requireMfa ? "require" : "offer");
      }
    } catch (e) {
      // Not a reason to lock somebody out of the app: the database is still
      // the boundary, and at aal1 it refuses manager work by itself.
      console.error("Could not check the MFA state:", e);
      setStage("satisfied");
    }
  }, [account.role]);

  useEffect(() => {
    assess();
  }, [assess]);

  async function submit() {
    if (!factor) return;
    setBusy(true);
    setError("");
    const result = await verifyCode(factor.id, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That code was not accepted.");
      setCode("");
      return;
    }
    await logMfaVerified();
    setStage("satisfied");
  }

  if (stage === "checking") {
    return (
      <div className="mx-auto mt-28 max-w-xs px-5">
        <p className="text-sm text-ink-3">Checking…</p>
      </div>
    );
  }

  if (stage === "satisfied") return <>{children}</>;

  // The account could use a second factor and nobody has required it yet.
  // The app is fully usable; this is a reminder sitting above it.
  if (stage === "offer") {
    return (
      <>
        {!deferred && (
          <div className="mx-auto mb-4 max-w-6xl px-5 print:hidden">
            {setupOpen ? (
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
                <div className="mb-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">Set up two-factor sign-in</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
                      About a minute, once per person. Until it is set up, the database refuses
                      exports, deletions and permission changes from this account.
                    </p>
                  </div>
                  <button
                    onClick={() => setSetupOpen(false)}
                    className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-medium text-ink-3 hover:border-line"
                  >
                    Close
                  </button>
                </div>
                <MfaSetup onDone={assess} onCancel={() => setDeferred(true)} />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                {/* basis-full so the two buttons drop to their own line on a
                    phone. The row wraps already, but flex-1 with min-w-0 lets
                    this paragraph shrink instead — so the buttons kept their
                    width and squeezed a four-line warning into eleven lines
                    down the left edge. It sits on every staff page, so it was
                    the first thing anyone saw on a phone. */}
                <p className="min-w-0 flex-1 basis-full text-xs leading-relaxed text-amber-900 sm:basis-0">
                  <span className="font-semibold">Two-factor sign-in is not set up.</span> Your role
                  can read every client record and download the client list, so a password on its
                  own is not enough. Exports, deletions and permission changes are refused until it
                  is.
                </p>
                <button
                  onClick={() => setSetupOpen(true)}
                  className="shrink-0 rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-600"
                >
                  Set it up
                </button>
                <button
                  onClick={() => setDeferred(true)}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-amber-900/70 hover:text-amber-900"
                >
                  Not now
                </button>
              </div>
            )}
          </div>
        )}
        {children}
      </>
    );
  }

  if (stage === "challenge") {
    return (
      <div className="mx-auto mt-28 flex max-w-xs flex-col gap-3 px-5">
        <h1 className="font-display text-xl font-semibold text-ink">Two-factor code</h1>
        <p className="-mt-1 text-xs leading-relaxed text-ink-3">
          {ROLE_LABELS[account.role ?? "manager"]} accounts need a code from the authenticator app
          as well as a password.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          className="rounded-xl border border-line bg-surface px-4 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        />
        <button
          onClick={submit}
          disabled={busy || code.length < 6}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
        <p className="text-[11px] leading-relaxed text-ink-3">
          Lost the phone with the app on it? An owner can lift the requirement for your account in
          Settings → Security, and you can set it up again on the new one.
        </p>
      </div>
    );
  }

  // stage === "require": an owner switched enforcement on for this account
  // and it has no authenticator yet. This is the only place an un-enrolled
  // account is blocked, and it takes a deliberate act to get here.
  return (
    <div className="mx-auto mt-20 max-w-xl px-5">
      <h1 className="font-display text-xl font-semibold text-ink">Two-factor sign-in is required</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-3">
        Two-factor sign-in has been switched on for this {ROLE_LABELS[account.role ?? "manager"]}{" "}
        account, and there is no authenticator set up on it yet. Setting one up takes about a
        minute.
      </p>
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <MfaSetup onDone={assess} />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
        If the phone the authenticator was on is lost, an owner can lift the requirement for this
        account in Settings → Security. If nobody can get in to do that, the break-glass steps are
        at the bottom of <code>security-rollback.sql</code>.
      </p>
    </div>
  );
}
