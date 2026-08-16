import { describe, expect, it } from "vitest";
import { boughtAgo, packageTotals } from "@/lib/packageMoney";
import { Package } from "@/types";

// What the package book is worth.
//
// A package is the revenue event: the money arrives the day it is sold, and
// every visit it later covers is $0 because it was already paid for. That
// makes unredeemed days a liability — cash in the till against service still
// owed — and it runs the opposite way to the balances beside it on screen.

const RATES = { daycare: 70, walk: 25 };
const NOW = new Date(2026, 7, 17); // 17 Aug 2026, local

const pkg = (over: Partial<Package>): Package =>
  ({
    id: "p",
    phone: "(415) 555-0000",
    dog_name: "Buki",
    total_days: 10,
    days_used: 0,
    price: 500,
    kind: "daycare",
    created_at: new Date(2026, 7, 5).toISOString(),
    ...over,
  }) as Package;

describe("packageTotals", () => {
  it("counts a sale in the month it was sold, by local time", () => {
    // A package sold at 5pm on the 31st belongs to that month. Using UTC
    // would push an evening sale into the next month's figures.
    const totals = packageTotals(
      [
        pkg({ id: "a", created_at: new Date(2026, 7, 31, 17, 0).toISOString() }),
        pkg({ id: "b", created_at: new Date(2026, 6, 20).toISOString() }), // July
      ],
      NOW,
      RATES
    );
    expect(totals.sold.count).toBe(1); // August: the sale on the 31st
    expect(totals.soldPrev.count).toBe(1); // July: the one on the 20th
  });

  it("values unredeemed days at what the client actually paid", () => {
    // 500 for 10 days, 4 used: 6 days left at 50/day = 300. Valuing them at
    // the walk-in rate would overstate the liability by the discount.
    const totals = packageTotals([pkg({ total_days: 10, days_used: 4, price: 500 })], NOW, RATES);
    expect(totals.unredeemed.amount).toBe(300);
    expect(totals.unredeemed.units.daycare).toBe(6);
    expect(totals.unredeemed.atWalkIn).toBe(6 * RATES.daycare);
  });

  it("nets a fully used package to nothing", () => {
    const totals = packageTotals([pkg({ total_days: 10, days_used: 10 })], NOW, RATES);
    expect(totals.unredeemed.amount).toBe(0);
    expect(totals.active.count).toBe(0);
  });

  it("counts an unpriced package's days but cannot value them", () => {
    // Real service owed that predates price recording. Reporting it as $0
    // would quietly understate the liability, so the days still count and
    // the count of unvaluable packages is reported separately.
    const totals = packageTotals([pkg({ price: null, total_days: 10, days_used: 2 })], NOW, RATES);
    expect(totals.unredeemed.unpriced).toBe(1);
    expect(totals.unredeemed.units.daycare).toBe(8);
    expect(totals.unredeemed.amount).toBe(0);
  });

  it("keeps walk packages and daycare packages apart", () => {
    const totals = packageTotals(
      [
        pkg({ id: "d", kind: "daycare", total_days: 10, days_used: 0, price: 500 }),
        pkg({ id: "w", kind: "walk", total_days: 8, days_used: 3, price: 160 }),
      ],
      NOW,
      RATES
    );
    expect(totals.unredeemed.units.daycare).toBe(10);
    expect(totals.unredeemed.units.walk).toBe(5);
    expect(totals.active.count).toBe(2);
  });
});

describe("boughtAgo", () => {
  it("flags a package still holding days after six months as stale", () => {
    // Walk packages never expire, so unused days pile up quietly for years.
    // A block still open after six months is worth a phone call.
    const old = new Date(2026, 0, 5).toISOString(); // ~7 months before NOW
    expect(boughtAgo(old, NOW).stale).toBe(true);
  });

  it("does not flag a recent one", () => {
    expect(boughtAgo(new Date(2026, 7, 10).toISOString(), NOW).stale).toBe(false);
  });

  it("says nothing when there is no date", () => {
    expect(boughtAgo(undefined, NOW).label).toBe("");
  });
});
