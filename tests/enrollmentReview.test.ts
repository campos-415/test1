import { describe, expect, it } from "vitest";
import { reviewChecks } from "@/lib/enrollmentReview";
import { emptyDog, emptyEnrollment, emptyOwner } from "@/lib/enrollment";
import { DogDraft, EnrollmentDraft } from "@/lib/enrollment";

// The checklist a reviewer sees before approving a household.
//
// Two levels, and the difference is the whole design: a BLOCKER is something
// that must be fixed, a WARNING is something to know. An honest answer about a
// dog that has growled is a reason to handle it carefully, not to turn it
// away — so behaviour is never a blocker. Missing paperwork is.
//
// Note the screen does not actually refuse an approval on a blocker: staff
// often have the certificate in hand while the client stands there. So these
// checks are the only thing standing between a half-finished form and a dog
// in a playgroup, which is why they are worth pinning.

const TODAY = "2026-08-17";

/** A submission with nothing wrong with it. */
function goodDraft(): EnrollmentDraft & { signature?: string } {
  const dog: DogDraft = {
    ...emptyDog(),
    dog_name: "Buki",
    vaccinesConfirmed: true,
    doc: { name: "vax.pdf", mime: "application/pdf", data: "x" },
    vaccines: {
      rabies: { given_on: "2026-01-01", expires_on: "2027-01-01" },
      dhpp: { given_on: "2026-01-01", expires_on: "2027-01-01" },
      bordetella: { given_on: "2026-01-01", expires_on: "2027-01-01" },
      influenza: { given_on: "2026-01-01", expires_on: "2027-01-01" },
      leptospirosis: { given_on: "2026-01-01", expires_on: "2027-01-01" },
    },
  } as DogDraft;

  return {
    ...emptyEnrollment(),
    owner: {
      ...emptyOwner(),
      owner_name: "Cesar",
      last_name: "Campos",
      phone: "(415) 555-0000",
      email: "a@example.com",
      emergency_name: "Sam",
      emergency_phone: "(415) 555-0001",
      vet_name: "Bay Vets",
    },
    dogs: [dog],
    contractAgreed: true,
    policyAgreed: true,
    signature: "data:image/png;base64,x",
  };
}

const labels = (d: Parameters<typeof reviewChecks>[0], stage: 1 | 2 = 2) =>
  reviewChecks(d, TODAY, stage).checks.map((c) => c.label);

describe("reviewChecks — a complete submission", () => {
  it("finds nothing to report", () => {
    const summary = reviewChecks(goodDraft(), TODAY);
    expect(summary.checks).toHaveLength(0);
    expect(summary.blockers).toBe(0);
    expect(summary.warnings).toBe(0);
  });
});

describe("reviewChecks — blockers", () => {
  it("survives a submission with no owner block rather than throwing", () => {
    // A malformed row must not take the whole Requests page down: React
    // unmounts the tree on a render throw, so one bad submission would
    // white-screen the queue staff would use to find it.
    const summary = reviewChecks(null, TODAY);
    expect(summary.blockers).toBeGreaterThan(0);
    expect(summary.checks[0].label).toMatch(/no owner details/i);
  });

  it("blocks on a missing phone number — it is how a client checks in", () => {
    const d = goodDraft();
    d.owner.phone = "";
    expect(labels(d)).toContain("No phone number");
  });

  it("blocks on unaccepted agreements and a missing signature", () => {
    const d = goodDraft();
    d.contractAgreed = false;
    d.policyAgreed = false;
    d.signature = "";
    const found = labels(d);
    expect(found).toContain("Contract not accepted");
    expect(found).toContain("Meet & greet policy not accepted");
    expect(found).toContain("Not signed");
  });

  it("blocks when no vaccination record was uploaded", () => {
    const d = goodDraft();
    delete (d.dogs[0] as { doc?: unknown }).doc;
    expect(labels(d)).toContain("No vaccination record uploaded");
  });

  it("blocks when the owner did not confirm the shots are current", () => {
    const d = goodDraft();
    d.dogs[0].vaccinesConfirmed = false;
    expect(labels(d)).toContain("Vaccinations not confirmed by the owner");
  });

  it("blocks until the three required expiry dates are entered", () => {
    // Rabies, DHPP and Bordetella. The owner is no longer asked to type
    // these — staff read them off the uploaded record — but they are
    // required, and approving without them creates a dog with no expiry
    // that nothing will ever chase.
    const d = goodDraft();
    d.dogs[0].vaccines = {} as DogDraft["vaccines"];
    const blocker = labels(d).find((l) => /Enter the expiry date/.test(l));
    expect(blocker).toBeDefined();
    expect(blocker).toContain("Rabies");
    expect(blocker).toContain("DHPP");
    expect(blocker).toContain("Bordetella");
  });

  it("only warns about the optional ones", () => {
    const d = goodDraft();
    d.dogs[0].vaccines = {
      rabies: { given_on: "", expires_on: "2027-01-01" },
      dhpp: { given_on: "", expires_on: "2027-01-01" },
      bordetella: { given_on: "", expires_on: "2027-01-01" },
    } as DogDraft["vaccines"];
    const summary = reviewChecks(d, TODAY);
    expect(summary.blockers).toBe(0);
    const warning = summary.checks.find((c) => /No date for/.test(c.label));
    expect(warning?.level).toBe("warning");
    expect(warning?.label).toMatch(/influenza/i);
  });

  it("blocks on a date that has already run out", () => {
    // A certificate read off correctly but expired last spring looks
    // complete and is not.
    const d = goodDraft();
    d.dogs[0].vaccines!.rabies = { given_on: "2025-01-01", expires_on: "2026-03-01" };
    const blocker = labels(d).find((l) => /^Expired:/.test(l));
    expect(blocker).toContain("Rabies");
  });

  it("does not treat a date expiring today as expired", () => {
    // The dog is covered through today. Turning it away would be wrong by
    // one day, and the client is standing there.
    const d = goodDraft();
    d.dogs[0].vaccines!.rabies = { given_on: "2025-01-01", expires_on: TODAY };
    expect(labels(d).some((l) => /^Expired:/.test(l))).toBe(false);
  });

  it("blocks when there are no dogs on the form", () => {
    const d = goodDraft();
    d.dogs = [];
    expect(labels(d)).toContain("No dogs on the form");
  });
});

describe("reviewChecks — behaviour is never a blocker", () => {
  it("warns about a bite history without refusing the dog", () => {
    const d = goodDraft();
    d.dogs[0].bitten = true;
    d.dogs[0].growled = true;
    d.dogs[0].dog_fight = true;
    d.dogs[0].climbed_fence = true;
    d.dogs[0].health_problems = true;
    d.dogs[0].allergies = ["Chicken"];
    d.dogs[0].fixed = false;

    const summary = reviewChecks(d, TODAY);
    expect(summary.blockers).toBe(0);
    expect(summary.warnings).toBeGreaterThanOrEqual(7);
    expect(summary.checks.every((c) => c.level === "warning")).toBe(true);
  });
});

describe("reviewChecks — what stage one is allowed to complain about", () => {
  it("does not chase a vet or emergency contact that has not been asked for yet", () => {
    // At stage one those questions are still coming, on the details form
    // emailed after the meet & greet. Flagging them would put a permanent
    // amber mark on every enrollment the moment it arrives.
    const d = goodDraft();
    d.owner.vet_name = "";
    d.owner.emergency_name = "";
    d.owner.emergency_phone = "";

    expect(labels(d, 1)).not.toContain("No veterinarian on file");
    expect(labels(d, 1)).not.toContain("No emergency contact");
    // The same submission at stage two is a different story.
    expect(labels(d, 2)).toContain("No veterinarian on file");
    expect(labels(d, 2)).toContain("No emergency contact");
  });
});

describe("reviewChecks — ordering and scope", () => {
  it("puts blockers before warnings", () => {
    // A reviewer scanning the top of the list should hit the reasons to stop
    // before the things merely worth knowing.
    const d = goodDraft();
    d.owner.email = ""; // warning
    d.signature = ""; // blocker
    const levels = reviewChecks(d, TODAY).checks.map((c) => c.level);
    expect(levels[0]).toBe("blocker");
    expect(levels.indexOf("blocker")).toBeLessThan(levels.indexOf("warning"));
  });

  it("names which dog a check belongs to on a multi-dog form", () => {
    const d = goodDraft();
    const second = { ...emptyDog(), dog_name: "Koda", vaccinesConfirmed: true } as DogDraft;
    d.dogs = [d.dogs[0], second];
    const koda = reviewChecks(d, TODAY).checks.filter((c) => c.scope === "Koda");
    expect(koda.length).toBeGreaterThan(0);
    // And the household-level ones carry no dog name.
    expect(reviewChecks(d, TODAY).checks.some((c) => c.scope === "Buki")).toBe(false);
  });

  it("calls an unnamed dog something rather than nothing", () => {
    const d = goodDraft();
    d.dogs[0].dog_name = "";
    const summary = reviewChecks(d, TODAY);
    expect(summary.checks.some((c) => c.scope === "Unnamed dog")).toBe(true);
    expect(summary.checks.some((c) => c.label === "No name given")).toBe(true);
  });
});
