"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { todayKey } from "@/lib/dates";
import { PendingPayment, TEST_PREFIX, parseSquareCallback, takePending } from "@/lib/square";

// Where the Square app sends the browser back to.
//
// This URL is registered in the Square developer console, so it has to be a
// fixed path — the context for the payment comes from the token Square
// echoes back, matched against what was stashed before the hand-off.
export default function PayReturnPage() {
  return (
    <Suspense fallback={null}>
      <PayReturn />
    </Suspense>
  );
}

type Status = "working" | "recorded" | "already" | "failed" | "orphan";

function PayReturn() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status>("working");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<PendingPayment | null>(null);
  // Strict mode runs effects twice in development; without this the payment
  // would be written to the ledger twice.
  const handled = useRef(false);
  const [isTest, setIsTest] = useState(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const result = parseSquareCallback(new URLSearchParams(params.toString()));
    if (!result) {
      setStatus("failed");
      setMessage("This page is where Square returns after a payment — there was no result on it.");
      return;
    }

    setIsTest((result.transactionId ?? "").startsWith(TEST_PREFIX));
    const stash = takePending(result.state);
    setPending(stash);

    if (!result.ok) {
      setStatus("failed");
      setMessage(result.errorMessage ?? "The payment did not go through.");
      return;
    }

    const reference = result.transactionId ?? result.clientTransactionId ?? "";

    if (!stash) {
      // No stash has two very different causes, and telling them apart
      // matters: this page is reloaded by a refresh or a back button far
      // more often than a payment genuinely goes missing.
      //
      // The stash is consumed on first use, so a reload always lands here —
      // and saying "not recorded" would send staff off to enter a payment
      // that is already in the ledger. Check before crying wolf.
      (async () => {
        if (reference) {
          try {
            const { data: seen } = await getSupabase()
              .from("payments")
              .select("id")
              .ilike("note", `%${reference}%`)
              .limit(1);
            if ((seen as { id: string }[] | null)?.length) {
              setStatus("already");
              setMessage("This payment is already on the ledger — nothing more to do.");
              return;
            }
          } catch (e) {
            console.error("Could not check whether the payment was recorded:", e);
          }
        }
        setStatus("orphan");
        setMessage(
          `Square took the payment (${reference || "no id"}), but this browser has no record of what it was for — it may have been started on another device. Record it manually on the owner profile.`
        );
      })();
      return;
    }

    (async () => {
      try {
        const supabase = getSupabase();

        // Square can return to this URL more than once — a refresh, or the
        // app re-opening the link. The transaction id makes the write
        // idempotent.
        if (reference) {
          const { data: seen } = await supabase
            .from("payments")
            .select("id")
            .eq("phone", stash.phone)
            .ilike("note", `%${reference}%`)
            .limit(1);
          if ((seen as { id: string }[] | null)?.length) {
            setStatus("already");
            setMessage("That payment was already recorded.");
            return;
          }
        }

        // A simulated payment is recorded so the balance visibly clears —
        // that is the thing worth testing — but labelled so it can never be
        // mistaken for money, and so Settings can find and delete it.
        const isTest = reference.startsWith(TEST_PREFIX);
        const { error } = await supabase.from("payments").insert({
          phone: stash.phone,
          amount: stash.amountCents / 100,
          method: "card",
          note: `${isTest ? "TEST (no money taken) " : ""}Square ${reference}${
            stash.dogNames.length ? ` · ${stash.dogNames.join(", ")}` : ""
          }`,
          paid_on: todayKey(),
        });
        if (error) throw error;
        setStatus("recorded");
      } catch (e) {
        console.error("Recording the Square payment failed:", e);
        // The money HAS moved. Losing the record silently would be the worst
        // outcome, so this is loud and tells staff exactly what to enter.
        setStatus("orphan");
        setMessage(
          `Square took $${(stash.amountCents / 100).toFixed(2)}, but it could not be saved to the ledger. Record it manually on the owner profile for ${stash.phone}.`
        );
      }
    })();
  }, [params]);

  const back = pending?.returnTo || "/in-house";

  return (
    <div className="mx-auto mt-24 max-w-sm px-6 text-center">
      {status === "working" && <p className="text-sm text-ink-3">Recording the payment…</p>}

      {status === "recorded" && (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-2xl text-white shadow-card">
            ✓
          </div>
          <p className="mt-4 text-lg font-medium text-ink">
            Paid ${((pending?.amountCents ?? 0) / 100).toFixed(2)}
          </p>
          <p className="mt-1 text-sm text-ink-3">
            Recorded against {pending?.phone}. The balance is up to date.
          </p>
          {isTest && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900">
              🧪 Test mode — no card was charged. Clear test payments from Settings → Pricing when
              you are done.
            </p>
          )}
        </>
      )}

      {status === "already" && (
        <>
          <p className="text-lg font-medium text-ink">Already recorded</p>
          <p className="mt-1 text-sm text-ink-3">{message}</p>
        </>
      )}

      {(status === "failed" || status === "orphan") && (
        <>
          <div
            className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full text-2xl text-white shadow-card ${
              status === "orphan" ? "bg-amber-500" : "bg-rose-500"
            }`}
          >
            {status === "orphan" ? "!" : "✕"}
          </div>
          <p className="mt-4 text-lg font-medium text-ink">
            {status === "orphan" ? "Paid, but not recorded" : "Not paid"}
          </p>
          <p className="mt-1 text-sm text-ink-3">{message}</p>
        </>
      )}

      <Link
        href={back}
        className="mt-6 inline-block rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600"
      >
        Back to the front desk
      </Link>
    </div>
  );
}
