import { describe, expect, it } from "vitest";
import { buildOpenVisits } from "@/lib/signin";
import { SignInRecord } from "@/types";

// Who is actually in the building.
//
// Everything downstream leans on this: the In House list, the day report, the
// kiosk deciding whether to offer drop-off or pick-up, and what a sign-out
// charges. It is a state machine over a flat log of taps, so the interesting
// cases are the ones a real front desk produces — the same dog in and out
// twice in a day, a tap recorded against a clock that is wrong.

const NOW = new Date("2026-08-17T15:00:00.000Z");

const row = (
  dogId: string,
  action: "drop_off" | "pick_up",
  iso: string,
  extra: Partial<SignInRecord> = {}
): Partial<SignInRecord> => ({
  dog_id: dogId,
  action,
  created_at: iso,
  service_type: "daycare",
  ...extra,
});

describe("buildOpenVisits", () => {
  it("counts a dog dropped off and not collected as in", () => {
    const open = buildOpenVisits([row("d1", "drop_off", "2026-08-17T08:00:00.000Z")], NOW);
    expect(open.has("d1")).toBe(true);
  });

  it("closes the visit once it is collected", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d1", "pick_up", "2026-08-17T14:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(false);
  });

  it("reopens on a second drop-off after a pick-up", () => {
    // A dog collected at lunch and brought back at two is in the building.
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d1", "pick_up", "2026-08-17T12:00:00.000Z"),
        row("d1", "drop_off", "2026-08-17T14:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(true);
    expect(open.get("d1")?.dropOffTime.toISOString()).toBe("2026-08-17T14:00:00.000Z");
  });

  it("ignores a drop-off timestamped in the future", () => {
    // The comment in the source calls this unrecoverable, and it is: a
    // future drop-off is later than every pick-up, so the visit can never be
    // closed and every sign-out prices the stay again.
    const open = buildOpenVisits(
      [row("d1", "drop_off", "2026-08-18T08:00:00.000Z")], // tomorrow
      NOW
    );
    expect(open.has("d1")).toBe(false);
  });

  it("still accepts a tap a few seconds ahead, for clock skew between devices", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString();
    const open = buildOpenVisits([row("d1", "drop_off", skewed)], NOW);
    expect(open.has("d1")).toBe(true);
  });

  it("ignores rows with no dog on them", () => {
    // Older rows recorded a name and no id. They cannot be attributed to a
    // dog, and guessing would put the wrong dog in the building.
    const open = buildOpenVisits(
      [{ action: "drop_off", created_at: "2026-08-17T08:00:00.000Z" }],
      NOW
    );
    expect(open.size).toBe(0);
  });

  it("keeps dogs separate", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z"),
        row("d2", "drop_off", "2026-08-17T08:05:00.000Z"),
        row("d1", "pick_up", "2026-08-17T13:00:00.000Z"),
      ],
      NOW
    );
    expect(open.has("d1")).toBe(false);
    expect(open.has("d2")).toBe(true);
  });

  it("carries the service and add-ons from the drop-off, so the sign-out prices what was agreed", () => {
    const open = buildOpenVisits(
      [
        row("d1", "drop_off", "2026-08-17T08:00:00.000Z", {
          service_type: "boarding",
          addons: ["bath"],
          bath_size: "M",
        }),
      ],
      NOW
    );
    expect(open.get("d1")?.serviceType).toBe("boarding");
    expect(open.get("d1")?.addons).toEqual(["bath"]);
    expect(open.get("d1")?.bathSize).toBe("M");
  });
});
