"use client";

import { useCallback, useEffect, useState } from "react";
import { EnrolmentStart, confirmEnrolment, startEnrolment } from "@/lib/mfa";
import { logMfaEnrolled } from "@/lib/audit";
import { requireMfaOnMyAccount } from "@/lib/roles";

// Setting up an authenticator app.
//
// The QR code is not drawn here - Supabase returns it already rendered as an
// SVG data URL, so there is no QR library in this app and no secret passing
// through code we would have to be careful with. The typed secret is offered
// underneath it because a wall-mounted iPad camera cannot photograph its own
// screen, and because some phones refuse a QR in dim lobby lighting.
//
// Finishing here does two things in one step: it verifies the factor, and it
// raises this session to aal2, so somebody who has just set MFA up carries
// on working rather than being asked for a second code immediately.

export default function MfaSetup({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [start, setStart] = useState<EnrolmentStart | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const begin = useCallback(async () => {
    setError("");
    try {
      setStart(await startEnrolment());
    } catch (e) {
      console.error("Could not start MFA enrolment:", e);
      setError("Could not start the setup. Check the connection and try again.");
    }
  }, []);

  useEffect(() => {
    begin();
  }, [begin]);

  async function submit() {
    if (!start) return;
    setBusy(true);
    setError("");
    const result = await confirmEnrolment(start.factorId, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That code was not accepted.");
      setCode("");
      return;
    }
    // The grace period that let this account sign in without a factor closes
    // now that it has one.
    await requireMfaOnMyAccount();
    await logMfaEnrolled();
    onDone();
  }

  if (!start) {
    // The escape has to be here as well as below, and this is the branch that
    // matters most. If Supabase cannot start an enrolment - the project has
    // MFA switched off, the network is out - then without a way past this
    // screen an owner who has not enrolled yet is locked out of their own
    // application by a feature that is not even working. That is a worse
    // outcome than not having MFA at all.
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-3">
          {error ? "Setup is not available right now." : "Preparing the setup…"}
        </p>
        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
        {error && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={begin}
              className="rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300"
            >
              Try again
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-600"
              >
                Skip for now and carry on
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-1 text-xs leading-relaxed text-ink-2">
        <li>
          1. Install an authenticator app if there is not one on the phone already — Google
          Authenticator, Microsoft Authenticator and 1Password all work.
        </li>
        <li>2. Scan this code with it.</li>
        <li>3. Type the six digits it shows.</li>
      </ol>

      <div className="flex flex-wrap items-start gap-4">
        <div className="rounded-2xl border border-line bg-white p-3">
          {/* A data URL, so next/image would add a loader for nothing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={start.qrCode} alt="Two-factor setup code" width={168} height={168} />
        </div>

        <div className="min-w-[13rem] flex-1 space-y-2">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Six-digit code from the app</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-lg tracking-[0.3em] text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={submit}
              disabled={busy || code.length < 6}
              className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
            >
              {busy ? "Checking…" : "Finish setup"}
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-3 hover:border-line"
              >
                Not now
              </button>
            )}
          </div>

          <button
            onClick={() => setShowSecret((v) => !v)}
            className="text-[11px] font-medium text-accent-600 hover:underline"
          >
            {showSecret ? "Hide the typed code" : "Cannot scan it?"}
          </button>
          {showSecret && (
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
              <p className="text-[11px] text-ink-3">Enter this in the app by hand:</p>
              <p className="mt-0.5 break-all font-mono text-xs text-ink">{start.secret}</p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}
