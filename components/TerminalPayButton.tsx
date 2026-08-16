"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useSettings } from "@/components/SettingsProvider";

/**
 * Taking a card payment on a Square Terminal, without leaving this app.
 *
 * The other Square button (SquarePayButton) navigates away to the Square app
 * and comes back through /pay/return. This one stays put: the server pushes
 * the amount to the Terminal, the client taps their card on that device, and
 * this polls until Square says what happened.
 *
 * Which means the screen has a state the other one never had — waiting, with
 * a card reader live in front of a client — and that state has to be
 * readable at a glance and cancellable, because the most common thing that
 * happens next is not "the card works" but "hold on, I have a different
 * card".
 */
type Phase = "idle" | "starting" | "waiting" | "done" | "failed";

export default function TerminalPayButton({
  amount,
  note,
  phone,
  dogNames,
  /** Stable per visit — it becomes Square's idempotency key. */
  reference,
  beforePay,
  onPaid,
}: {
  amount: number;
  note: string;
  phone: string;
  dogNames: string[];
  reference: string;
  beforePay?: () => Promise<boolean>;
  onPaid?: () => void;
}) {
  const { settings } = useSettings();
  const square = settings.square;
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const checkoutId = useRef<string | null>(null);
  const stopped = useRef(false);

  // Polling must not outlive the screen. Without this a staff member who
  // navigates away mid-payment leaves a timer running against an unmounted
  // component, and the payment it eventually sees is recorded by nobody.
  useEffect(() => {
    return () => {
      stopped.current = true;
    };
  }, []);

  if (!square.enabled || square.mode !== "terminal") return null;
  if (amount <= 0) return null;

  async function call(body: Record<string, unknown>) {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Not signed in.");
    const res = await fetch("/api/square/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, sandbox: square.testMode }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "That did not work.");
    return json as Record<string, unknown>;
  }

  /** The money moved, so the record must exist even if everything else fails. */
  async function record(paymentId: string | null) {
    const { error } = await getSupabase().from("payments").insert({
      phone,
      amount,
      method: "card",
      note: `${square.testMode ? "TEST (no money taken) " : ""}Square Terminal ${
        paymentId ?? "no id"
      }${dogNames.length ? ` · ${dogNames.join(", ")}` : ""}`,
      paid_on: new Date().toISOString().slice(0, 10),
    });
    if (error) {
      // Loud, and with the number in it. A payment that happened and was not
      // recorded is worse than one that failed, because nothing about the
      // screen suggests anything is wrong.
      console.error("Recording the terminal payment failed:", error);
      setPhase("failed");
      setMessage(
        `The card was charged $${amount.toFixed(2)} but it could not be saved. Record it by hand on the owner profile before doing anything else.`
      );
      return;
    }
    setPhase("done");
    setMessage("Paid.");
    onPaid?.();
  }

  async function pay() {
    setMessage("");
    if (beforePay) {
      setPhase("starting");
      let go = false;
      try {
        go = await beforePay();
      } catch (e) {
        console.error("The step before payment failed:", e);
      }
      if (!go) {
        setPhase("idle");
        return;
      }
    }

    setPhase("starting");
    try {
      const started = await call({
        action: "charge",
        amountCents: Math.round(amount * 100),
        deviceId: square.terminalDeviceId,
        note,
        reference,
      });
      checkoutId.current = (started.checkoutId as string) ?? null;
      if (!checkoutId.current) throw new Error("Square did not start a checkout.");
      setPhase("waiting");
      setMessage("Ask the client to tap or insert their card.");
      poll();
    } catch (e) {
      setPhase("failed");
      setMessage(e instanceof Error ? e.message : "Could not reach the terminal.");
    }
  }

  // Two minutes at two seconds, which is longer than anybody stands at a
  // counter and short enough that a forgotten checkout does not poll forever.
  async function poll(attempt = 0) {
    if (stopped.current || !checkoutId.current) return;
    if (attempt > 60) {
      setPhase("failed");
      setMessage("The terminal did not answer. Check the device, then try again.");
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
    if (stopped.current) return;
    try {
      const res = await call({ action: "status", checkoutId: checkoutId.current });
      const status = String(res.status ?? "");
      if (status === "COMPLETED") {
        await record((res.paymentId as string) ?? null);
        return;
      }
      if (status === "CANCELED" || status === "CANCEL_REQUESTED") {
        setPhase("idle");
        setMessage(
          res.cancelReason ? `Cancelled on the terminal (${res.cancelReason}).` : "Cancelled."
        );
        return;
      }
      poll(attempt + 1);
    } catch (e) {
      setPhase("failed");
      setMessage(e instanceof Error ? e.message : "Lost contact with Square.");
    }
  }

  const busy = phase === "starting" || phase === "waiting";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        onClick={pay}
        disabled={busy || phase === "done"}
        className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:opacity-60"
      >
        {phase === "starting"
          ? "Sending to the terminal…"
          : phase === "waiting"
            ? "Waiting for the card…"
            : phase === "done"
              ? "✓ Paid"
              : square.testMode
                ? "Charge card (test)"
                : "Charge card"}
      </button>
      {message && (
        <span
          className={`text-[11px] ${
            phase === "failed" ? "font-medium text-rose-600" : "text-ink-3"
          }`}
        >
          {message}
        </span>
      )}
    </span>
  );
}
