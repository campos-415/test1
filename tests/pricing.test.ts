import { describe, expect, it } from "vitest";
import {
  bathSizeForWeight,
  estimateBoardingTotal,
  estimatePrice,
  isFullDayVisit,
  nightsBetweenKeys,
} from "@/lib/pricing";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// What the daycare charges. Read against DEFAULT_SETTINGS, which is what
// getSettings() returns until a real install loads its own row — so these
// assert the shipped price list:
//
//   full day 70, half day 50, boarding 90/night
//   second dog: 60 full, 50 half, 80/night boarding
//   half-day threshold 4 hours, bath sizes S<=25lb, M<=60lb
const P = DEFAULT_SETTINGS.pricing;

/** A visit on one day, given in whole hours. */
const visit = (fromHour: number, toHour: number): [Date, Date] => [
  new Date(2026, 7, 17, fromHour, 0),
  new Date(2026, 7, 17, toHour, 0),
];

const total = (e: ReturnType<typeof estimatePrice>) => e?.amount ?? null;

describe("isFullDayVisit", () => {
  it("is a half day at exactly the threshold, and a full day past it", () => {
    // The boundary decides a $20 difference, so it is pinned rather than
    // left to whichever way > happened to be written.
    expect(isFullDayVisit(...visit(8, 12))).toBe(false); // 4h, at the threshold
    expect(isFullDayVisit(...visit(8, 13))).toBe(true); // 5h
  });
});

describe("estimatePrice — daycare", () => {
  it("charges the full-day rate for a long visit and the half-day rate for a short one", () => {
    expect(total(estimatePrice("daycare", ...visit(8, 17)))).toBe(P.daycareFullDay);
    expect(total(estimatePrice("daycare", ...visit(8, 11)))).toBe(P.daycareHalfDay);
  });

  it("charges the second dog less", () => {
    // The bug this exists for: the second-dog rate was editable in Settings
    // and printed on the public price table while no pricing path could
    // reach it, so every household with two dogs was billed twice at full
    // price. A test on the discount would have caught it the day it shipped.
    const one = total(estimatePrice("daycare", ...visit(8, 17), [], false, null, true, null, false, false));
    const two = total(estimatePrice("daycare", ...visit(8, 17), [], false, null, true, null, false, true));
    expect(one).toBe(P.daycareFullDay);
    expect(two).toBe(P.daycareSecondDogFullDay);
    expect(two).toBeLessThan(one as number);
  });

  it("shows a package-covered day as a zero line rather than omitting it", () => {
    const e = estimatePrice("daycare", ...visit(8, 17), [], true);
    expect(e?.amount).toBe(0);
    // Dropping the line would make the receipt look like the charge went
    // missing rather than like the package paid for it.
    expect(e?.breakdown.some((b) => /covered by package/.test(b.label))).toBe(true);
  });
});

describe("estimatePrice — boarding", () => {
  it("charges per night, and less per night for the second dog", () => {
    const [start, end] = [new Date(2026, 7, 17, 9, 0), new Date(2026, 7, 20, 9, 0)];
    const one = total(estimatePrice("boarding", start, end, [], false, null, true, null, false, false));
    const two = total(estimatePrice("boarding", start, end, [], false, null, true, null, false, true));
    expect(one).toBe(3 * P.boardingPerNight);
    expect(two).toBe(3 * P.boardingSecondDogPerNight);
  });
});

describe("bathSizeForWeight", () => {
  it("puts the boundary weight in the smaller band", () => {
    // Documented as inclusive at the top: 25lb is small, 25.5 is medium.
    // Whoever owns the boundary should be the cheaper band.
    expect(bathSizeForWeight(P.bathWeightMax.S)).toBe("S");
    expect(bathSizeForWeight(P.bathWeightMax.S + 0.5)).toBe("M");
    expect(bathSizeForWeight(P.bathWeightMax.M)).toBe("M");
    expect(bathSizeForWeight(P.bathWeightMax.M + 0.5)).toBe("L");
  });

  it("returns null rather than guessing when the weight is missing or nonsense", () => {
    // A dog with no weight must not be silently billed as small.
    expect(bathSizeForWeight(null)).toBeNull();
    expect(bathSizeForWeight(undefined)).toBeNull();
    expect(bathSizeForWeight(0)).toBeNull();
    expect(bathSizeForWeight(-5)).toBeNull();
    expect(bathSizeForWeight(Number.NaN)).toBeNull();
  });
});

describe("nightsBetweenKeys", () => {
  it("counts nights, not days", () => {
    expect(nightsBetweenKeys("2026-08-17", "2026-08-18")).toBe(1);
    expect(nightsBetweenKeys("2026-08-17", "2026-08-20")).toBe(3);
  });

  it("never returns zero for a same-day stay", () => {
    // A dog dropped off and collected on one date still occupied a run and
    // still costs a night. Zero here would produce a free stay.
    expect(nightsBetweenKeys("2026-08-17", "2026-08-17")).toBe(1);
  });

  it("does not shift across a month boundary", () => {
    expect(nightsBetweenKeys("2026-08-31", "2026-09-01")).toBe(1);
  });
});

describe("estimateBoardingTotal", () => {
  it("prices a plain stay at the nightly rate", () => {
    const nights = nightsBetweenKeys("2026-08-17", "2026-08-20");
    const e = estimateBoardingTotal("2026-08-17", "2026-08-20", { addons: [] });
    expect(e.amount).toBe(nights * P.boardingPerNight);
  });
});
