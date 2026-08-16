"use client";

// A household's balance at a glance. Deliberately loud when money is owed
// and quiet when it isn't — a settled account shouldn't compete for
// attention with the rest of a profile.
export default function BalanceBadge({
  outstanding,
  className = "",
}: {
  outstanding: number;
  className?: string;
}) {
  if (outstanding > 0.005) {
    return (
      <span
        className={`rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ${className}`}
      >
        💰 ${outstanding.toFixed(2)} owed
      </span>
    );
  }
  if (outstanding < -0.005) {
    return (
      <span
        className={`rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-700 ${className}`}
      >
        💰 ${Math.abs(outstanding).toFixed(2)} in credit
      </span>
    );
  }
  return (
    <span
      className={`rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ${className}`}
    >
      ✓ Paid up
    </span>
  );
}
