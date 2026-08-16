import { describe, expect, it } from "vitest";
import { dateKey, dateRange, parseDateKey, prettyDateKey, todayKey } from "@/lib/dates";

// "YYYY-MM-DD" local date keys. Every page compares dates through these so
// nothing drifts by a timezone — the bug this module exists to prevent is an
// evening drop-off being filed against tomorrow because somebody reached for
// toISOString().

describe("dateKey", () => {
  it("renders the LOCAL date, not the UTC one", () => {
    // 11pm on the 17th, local. toISOString() would say the 18th anywhere
    // west of Greenwich — and that is a boarding night on the wrong date.
    const lateEvening = new Date(2026, 7, 17, 23, 30);
    expect(dateKey(lateEvening)).toBe("2026-08-17");
  });

  it("pads single-digit months and days, so keys sort as strings", () => {
    // The whole app compares these with < and >, which only works if every
    // key is the same width.
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("parseDateKey", () => {
  it("round-trips with dateKey", () => {
    expect(dateKey(parseDateKey("2026-08-17"))).toBe("2026-08-17");
  });

  it("returns local midnight rather than a UTC instant", () => {
    // `new Date("2026-08-17")` is UTC midnight, which in California is the
    // 16th at 5pm. That single character of difference moves a reservation.
    const d = parseDateKey("2026-08-17");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(17);
    expect(d.getHours()).toBe(0);
  });
});

describe("dateRange", () => {
  it("is inclusive at both ends", () => {
    expect(dateRange("2026-08-17", "2026-08-20")).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
    ]);
  });

  it("returns the single day when start and end match", () => {
    expect(dateRange("2026-08-17", "2026-08-17")).toEqual(["2026-08-17"]);
  });

  it("crosses a month boundary", () => {
    expect(dateRange("2026-08-30", "2026-09-01")).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
    ]);
  });

  it("crosses a leap day", () => {
    expect(dateRange("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(dateRange("2026-12-31", "2027-01-01")).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("returns nothing when the end is before the start", () => {
    // Rather than looping forever, which is the other way this could go.
    expect(dateRange("2026-08-20", "2026-08-17")).toEqual([]);
  });

  it("does not skip or repeat a day across a daylight-saving change", () => {
    // US clocks go forward on 8 March 2026 and back on 1 November. A range
    // built by adding 24 hours would lose one day and double another; this
    // one steps the calendar date, which is why it does not.
    const spring = dateRange("2026-03-07", "2026-03-09");
    expect(spring).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    const autumn = dateRange("2026-10-31", "2026-11-02");
    expect(autumn).toEqual(["2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("todayKey", () => {
  it("agrees with dateKey on the current clock", () => {
    expect(todayKey()).toBe(dateKey(new Date()));
  });
});

describe("prettyDateKey", () => {
  it("names the right weekday", () => {
    // 17 August 2026 is a Monday. If this ever renders Sunday, the key was
    // parsed as UTC somewhere.
    expect(prettyDateKey("2026-08-17")).toMatch(/Mon/);
  });
});
