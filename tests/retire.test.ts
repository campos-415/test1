import { describe, expect, it } from "vitest";
import { RETIRE_REASONS, activeDogs, isRetired, retireReasonLabel, retiredDogs } from "@/lib/retire";
import { Dog } from "@/types";

// Retiring a dog. The rule the whole app follows: a retired dog disappears
// from anything that books, charges or checks a dog in, and stays visible
// anywhere that looks at history.
//
// The filters are done on data already in hand rather than in the query, so
// they also have to behave on an install that has not run
// dog-retire-migration.sql — where the column does not exist and every dog
// arrives with retired_at undefined.

const dog = (dog_name: string, retired_at: string | null | undefined = null) =>
  ({ dog_name, retired_at, phone: "(415) 555-0000", last_name: "Test" }) as Dog;

describe("isRetired", () => {
  it("is false when the column is absent, not just when it is null", () => {
    // The pre-migration case. Reading undefined as retired would empty the
    // kiosk lookup for every household in the business at once.
    expect(isRetired({ retired_at: undefined })).toBe(false);
    expect(isRetired({ retired_at: null })).toBe(false);
    expect(isRetired(null)).toBe(false);
    expect(isRetired(undefined)).toBe(false);
  });

  it("is true once a date is set", () => {
    expect(isRetired({ retired_at: "2026-08-16T00:00:00.000Z" })).toBe(true);
  });
});

describe("activeDogs / retiredDogs", () => {
  const dogs = [dog("Buki", "2026-08-16T00:00:00.000Z"), dog("Koda"), dog("Legacy", undefined)];

  it("keeps the dogs still coming, including ones from before the migration", () => {
    expect(activeDogs(dogs).map((d) => d.dog_name)).toEqual(["Koda", "Legacy"]);
  });

  it("separates out the retired ones", () => {
    expect(retiredDogs(dogs).map((d) => d.dog_name)).toEqual(["Buki"]);
  });

  it("splits the list without losing or duplicating anybody", () => {
    expect(activeDogs(dogs).length + retiredDogs(dogs).length).toBe(dogs.length);
  });

  it("does not mutate what it was given", () => {
    const before = dogs.map((d) => d.dog_name);
    activeDogs(dogs);
    retiredDogs(dogs);
    expect(dogs.map((d) => d.dog_name)).toEqual(before);
  });
});

describe("retireReasonLabel", () => {
  it("reads back every reason the panel offers", () => {
    for (const r of RETIRE_REASONS) {
      expect(retireReasonLabel(r.key)).toBe(r.label);
    }
  });

  it("falls back to something sayable rather than blank", () => {
    // A row retired before the reasons existed, or by hand in SQL.
    expect(retireReasonLabel(null)).toBe("Retired");
    expect(retireReasonLabel("something_else")).toBe("something_else");
  });
});
