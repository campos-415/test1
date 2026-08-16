import { describe, expect, it } from "vitest";
import {
  ageFromBirthdate,
  dogPatch,
  emptyDog,
  emptyOwner,
  toFixedStatus,
  withoutBlankAnswers,
} from "@/lib/enrollment";

// What approving an enrollment writes to a dog.
//
// The stakes here are not cosmetic: these columns carry the allergy list, the
// bite history and the activity restrictions that staff read before putting a
// dog into a playgroup. A patch that blanks one is a safety fact quietly
// deleted, and nothing on screen would say so.

describe("withoutBlankAnswers", () => {
  it("drops a blank allergy list rather than writing it over a recorded one", () => {
    // The bug: a household adding a second dog from the portal files at
    // stage two, because their address and vet are on file. But that form
    // never asks about allergies — so approving it onto a dog of the same
    // name wrote `allergies: []` over a live profile, erasing a peanut
    // allergy in the course of adding a different dog.
    const patch = withoutBlankAnswers({
      dog_name: "Buki",
      allergies: [],
      activity_restrictions: [],
      behavior_traits: [],
      play_style: [],
    });
    expect(patch).not.toHaveProperty("allergies");
    expect(patch).not.toHaveProperty("activity_restrictions");
    expect(patch).not.toHaveProperty("behavior_traits");
    expect(patch).not.toHaveProperty("play_style");
  });

  it("keeps an answer that was actually given", () => {
    const patch = withoutBlankAnswers({ allergies: ["Chicken"], health_problems: true });
    expect(patch.allergies).toEqual(["Chicken"]);
    expect(patch.health_problems).toBe(true);
  });

  it("keeps a recorded 'no' — false is an answer, not a blank", () => {
    // null means never asked and false means asked and answered no. Treating
    // them alike would lose the difference the profile is built on.
    const patch = withoutBlankAnswers({ bitten: false, growled: false });
    expect(patch.bitten).toBe(false);
    expect(patch.growled).toBe(false);
  });

  it("leaves stage-one fields alone, blank or not", () => {
    // Only stage two is protected. Stage one clears deliberately: a dog
    // recorded as fixed has its scheduled surgery date wiped on purpose, and
    // stripping that would leave a stale appointment on the profile forever.
    const patch = withoutBlankAnswers({ fixed_scheduled_on: null, meet_greet_on: null });
    expect(patch).toHaveProperty("fixed_scheduled_on");
    expect(patch).toHaveProperty("meet_greet_on");
  });
});

describe("dogPatch — what each stage is allowed to write", () => {
  const dog = emptyDog();
  const owner = emptyOwner();

  it("writes no stage-two columns at stage one", () => {
    // At stage one the behaviour questions have not been ASKED. Writing them
    // as nulls and empty arrays would make "not asked yet" indistinguishable
    // from "answered no" on the profile.
    const patch = dogPatch({ ...dog, dog_name: "Koda" }, owner, 1);
    expect(patch).not.toHaveProperty("allergies");
    expect(patch).not.toHaveProperty("bitten");
    expect(patch.dog_name).toBe("Koda");
  });

  it("includes them at stage two", () => {
    const patch = dogPatch({ ...dog, dog_name: "Koda" }, owner, 2);
    expect(patch).toHaveProperty("allergies");
    expect(patch).toHaveProperty("bitten");
  });
});

describe("toFixedStatus", () => {
  it("names the operation correctly per sex", () => {
    expect(toFixedStatus("female", true)).toBe("spayed");
    expect(toFixedStatus("male", true)).toBe("neutered");
  });

  it("says unknown rather than guessing when the sex is not on file", () => {
    expect(toFixedStatus("", true)).toBe("unknown");
  });

  it("distinguishes intact from unanswered", () => {
    expect(toFixedStatus("male", false)).toBe("intact");
    expect(toFixedStatus("male", null)).toBeNull();
  });
});

describe("ageFromBirthdate", () => {
  // Reads the clock internally, so the cases are built relative to today
  // rather than pinned to a date that would rot.
  //
  // Built in LOCAL time and anchored to the 1st. toISOString() would render
  // the UTC day, which west of Greenwich is tomorrow's date for most of the
  // evening — enough to push the day-of-month comparison over and turn five
  // months into four. Anchoring to the 1st also dodges the other trap:
  // subtracting a month from the 31st lands in the month after the one meant.
  const monthsAgo = (n: number) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
    const pad = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it("counts in months under two years, because that is how puppies are talked about", () => {
    expect(ageFromBirthdate(monthsAgo(5))).toBe("5 months");
    expect(ageFromBirthdate(monthsAgo(1))).toBe("1 month");
  });

  it("switches to years at two", () => {
    expect(ageFromBirthdate(monthsAgo(24))).toBe("2 years");
    expect(ageFromBirthdate(monthsAgo(30))).toBe("2 yr 6 mo");
  });

  it("returns nothing for a missing, unparseable, or future date", () => {
    expect(ageFromBirthdate("")).toBe("");
    expect(ageFromBirthdate(null)).toBe("");
    expect(ageFromBirthdate("not a date")).toBe("");
    expect(ageFromBirthdate(monthsAgo(-6))).toBe(""); // born in six months
  });
});
