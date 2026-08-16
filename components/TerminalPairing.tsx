"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

/**
 * Pairing a Square Terminal to this app.
 *
 * Square will not hand out a device id. You ask it for a short code, type
 * that code into the Terminal, and the Terminal becomes addressable — so
 * without this button there is no way to fill in the device id field, and
 * the whole Terminal integration is unreachable however correct it is.
 *
 * The code is shown once and expires in five minutes, which is Square's
 * rule rather than ours. Long enough to walk to the front desk.
 */
export default function TerminalPairing({
  locationId,
  sandbox,
  onPaired,
}: {
  locationId: string;
  sandbox: boolean;
  onPaired?: (deviceId: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pair() {
    setBusy(true);
    setError("");
    setCode("");
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again and retry.");
      const res = await fetch("/api/square/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "pair", locationId: locationId || undefined, sandbox }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Square would not issue a code.");
      if (!json.pairingCode) throw new Error("Square issued no code.");
      setCode(json.pairingCode as string);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach Square.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={pair}
          disabled={busy}
          className="rounded-xl border border-line px-3.5 py-2 text-xs font-medium text-ink-2 transition hover:border-accent-300 disabled:opacity-60"
        >
          {busy ? "Asking Square…" : code ? "Get another code" : "Pair a terminal"}
        </button>
        {code && (
          <span className="font-mono text-2xl font-semibold tracking-[0.2em] text-ink">{code}</span>
        )}
      </div>

      {code && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          On the Terminal: <strong>Sign in with a device code</strong>, then enter the code above.
          It expires in about five minutes. Once it has paired, Square shows the device ID — paste
          that into the box below.
        </p>
      )}
      {error && <p className="mt-2 text-[11px] font-medium text-rose-600">{error}</p>}
      {!code && !error && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Needs <code>SQUARE_ACCESS_TOKEN</code> set on the server. Without it this reports that it
          is not configured, rather than failing later with a client standing at the counter.
        </p>
      )}
    </div>
  );
}
