// What the package book is worth.
//
// A package is the revenue event: the money arrives on the day it is sold,
// and every visit it later covers is $0 because it was already paid for.
// That makes the interesting number the one nothing computed until now —
// days bought and not yet taken. It is cash in the till against service
// still owed, and for a daycare selling ten-day blocks it is not small.
//
// Valued at what the client actually paid per day, so a package nets to
// exactly zero over its life. The same days priced at the walk-in rate are
// reported alongside, because that difference is what the discount costs.

import { Package } from "@/types";
import { daysLeft, packageKind } from "@/lib/dogs";

export interface KindSplit {
  daycare: number;
  walk: number;
}

export interface PackageTotals {
  sold: { count: number; amount: number };
  /** The month before, so "sold this month" has something to be judged against. */
  soldPrev: { count: number; amount: number };
  active: { count: number; split: KindSplit };
  unredeemed: {
    amount: number;
    /** Days and walks bought but not yet taken. */
    units: KindSplit;
    /** Active packages sold before prices were recorded — they cannot be valued. */
    unpriced: number;
    /** The same unused units at the walk-in rate. */
    atWalkIn: number;
  };
}

export function packageTotals(
  packages: Package[],
  now: Date,
  rates: { daycare: number; walk: number }
): PackageTotals {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const sold = { count: 0, amount: 0 };
  const soldPrev = { count: 0, amount: 0 };
  const split: KindSplit = { daycare: 0, walk: 0 };
  const units: KindSplit = { daycare: 0, walk: 0 };
  let activeCount = 0;
  let amount = 0;
  let atWalkIn = 0;
  let unpriced = 0;

  for (const pkg of packages) {
    if (inMonth(pkg.created_at, now)) {
      sold.count += 1;
      sold.amount += pkg.price ?? 0;
    } else if (inMonth(pkg.created_at, prev)) {
      soldPrev.count += 1;
      soldPrev.amount += pkg.price ?? 0;
    }

    const left = daysLeft(pkg);
    if (left <= 0) continue;

    const kind = packageKind(pkg);
    activeCount += 1;
    split[kind] += 1;
    units[kind] += left;
    atWalkIn += left * rates[kind];

    // A package with no price on it is real service owed, so it still counts
    // in the units above — it just cannot be turned into a number. Reporting
    // it as $0 would quietly understate the liability.
    if (pkg.price == null || pkg.total_days <= 0) {
      unpriced += 1;
      continue;
    }
    amount += (pkg.price / pkg.total_days) * left;
  }

  return {
    sold,
    soldPrev,
    active: { count: activeCount, split },
    unredeemed: { amount, units, unpriced, atWalkIn },
  };
}

/** Local months, not UTC — a package sold at 5pm on the 31st belongs to that month. */
function inMonth(iso: string | undefined, month: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
}

/**
 * How long ago a package was bought, short enough for a table cell.
 *
 * `stale` is the one that matters: walk packages never expire, so unused days
 * pile up quietly for years. A package still holding days after six months is
 * worth a phone call, not a write-off.
 */
export function boughtAgo(iso: string | undefined, now: Date): { label: string; stale: boolean } {
  if (!iso) return { label: "", stale: false };
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return { label: "", stale: false };

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 0) return { label: "today", stale: false };
  if (days === 0) return { label: "today", stale: false };
  if (days === 1) return { label: "yesterday", stale: false };
  if (days < 14) return { label: `${days} days ago`, stale: false };
  if (days < 60) return { label: `${Math.floor(days / 7)} weeks ago`, stale: false };

  const months = Math.floor(days / 30.44);
  if (months < 12) return { label: `${months} months ago`, stale: months >= 6 };
  const years = Math.floor(days / 365.25);
  return { label: years === 1 ? "a year ago" : `${years} years ago`, stale: true };
}
