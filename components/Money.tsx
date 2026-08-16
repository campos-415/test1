"use client";

// A price, coloured for whether it has actually been paid.
//
// Everything used to be emerald, which reads as "fine" — so a stay nobody
// has paid for looked exactly like one that was settled weeks ago, and the
// only way to find out was to open the owner's profile.
//
// Three states, because two would force a lie. An estimate for a stay that
// has not happened yet is not unpaid; nothing is owed on it, and painting it
// red would have staff chasing money that was never due.

export type PayState = "unpaid" | "paid" | "estimate";

const TONE: Record<PayState, string> = {
  unpaid: "text-rose-600 font-semibold",
  paid: "text-emerald-700",
  // Deliberately not green: it has not been paid either.
  estimate: "text-ink-2",
};

const TITLE: Record<PayState, string> = {
  unpaid: "Unpaid",
  paid: "Paid",
  estimate: "Estimate — not charged yet",
};

export default function Money({
  amount,
  state,
  className = "",
  prefix,
}: {
  amount: number;
  state: PayState;
  className?: string;
  /** Rendered before the figure, e.g. an icon. */
  prefix?: string;
}) {
  return (
    <span
      title={TITLE[state]}
      // Printed sheets are black and white, so the state has to survive as a
      // word rather than a colour.
      className={`tabular-nums ${TONE[state]} ${className} print:text-ink`}>
      {prefix}${amount.toFixed(2)}
      {state === "unpaid" && (
        <span className="ml-1 text-[10px] font-medium uppercase tracking-wide">unpaid</span>
      )}
    </span>
  );
}
