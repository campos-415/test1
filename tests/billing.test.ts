import { describe, expect, it } from "vitest";
import { computeBalance, signinChargeKey, unpaidCharges } from "@/lib/billing";
import { Package, Payment, SignInRecord } from "@/types";

// The household balance. One family pays one bill covering every dog on the
// number, and payments settle the OLDEST charge first — which is the rule that
// makes "days overdue" mean anything. If payments landed against whichever
// charge was convenient, an account could show nothing overdue while the
// oldest debt sat untouched.

const pickUp = (id: string, day: string, price: number | null, dog = "Buki"): SignInRecord =>
  ({
    id,
    dog_name: dog,
    phone: "(415) 555-0000",
    action: "pick_up",
    service_type: "daycare",
    price,
    created_at: `${day}T17:00:00.000Z`,
  }) as SignInRecord;

const payment = (amount: number, paid_on: string): Payment =>
  ({ phone: "(415) 555-0000", amount, paid_on }) as Payment;

describe("computeBalance", () => {
  it("charges only priced pick-ups — a drop-off is not a bill", () => {
    const balance = computeBalance(
      [
        pickUp("a", "2026-08-10", 70),
        { ...pickUp("b", "2026-08-11", 70), action: "drop_off" } as SignInRecord,
      ],
      [],
      []
    );
    expect(balance.charges).toHaveLength(1);
    expect(balance.charged).toBe(70);
  });

  it("skips a pick-up with no price rather than counting it as zero", () => {
    // An unpriced visit is one nobody has settled yet, not a free one.
    const balance = computeBalance([pickUp("a", "2026-08-10", null)], [], []);
    expect(balance.charges).toHaveLength(0);
  });

  it("nets to exactly zero on a settled account", () => {
    // Floating-point noise here renders as a fraction-of-a-penny balance on
    // a paid-up account, which reads as a bug to whoever is looking at it.
    const balance = computeBalance(
      [pickUp("a", "2026-08-10", 70.1), pickUp("b", "2026-08-11", 0.2)],
      [],
      [payment(70.3, "2026-08-11")]
    );
    expect(balance.outstanding).toBe(0);
  });

  it("counts a package as revenue on the day it was sold", () => {
    const pkg = {
      id: "p1",
      phone: "(415) 555-0000",
      dog_name: "Buki",
      total_days: 10,
      days_used: 0,
      price: 325,
      kind: "daycare",
      created_at: "2026-08-01T12:00:00.000Z",
    } as Package;
    const balance = computeBalance([], [pkg], []);
    expect(balance.charged).toBe(325);
  });
});

describe("unpaidCharges — oldest first", () => {
  const charges = [
    pickUp("old", "2026-08-01", 70),
    pickUp("mid", "2026-08-10", 70),
    pickUp("new", "2026-08-20", 70),
  ];

  it("clears the oldest charge before touching a newer one", () => {
    const balance = computeBalance(charges, [], [payment(70, "2026-08-21")]);
    const unpaid = unpaidCharges(balance);
    // 210 charged, 70 paid: the August 1st visit is settled, the other two
    // are not. The wrong order here would report the oldest as outstanding
    // forever while newer ones quietly cleared.
    expect(unpaid.map((c) => c.key)).not.toContain(signinChargeKey("old"));
    expect(unpaid).toHaveLength(2);
    expect(balance.outstanding).toBe(140);
  });

  it("splits a payment across a charge it only partly covers", () => {
    const balance = computeBalance(charges, [], [payment(100, "2026-08-21")]);
    const unpaid = unpaidCharges(balance);
    // 100 pays off the first 70 and 30 of the second, leaving 40 on it.
    const mid = unpaid.find((c) => c.key === signinChargeKey("mid"));
    expect(mid?.remaining).toBe(40);
  });

  it("reports nothing outstanding once everything is paid", () => {
    const balance = computeBalance(charges, [], [payment(210, "2026-08-21")]);
    expect(unpaidCharges(balance)).toHaveLength(0);
    expect(balance.outstanding).toBe(0);
  });

  it("lists what is unpaid newest first, for reading", () => {
    const balance = computeBalance(charges, [], []);
    const unpaid = unpaidCharges(balance);
    expect(unpaid[0].key).toBe(signinChargeKey("new"));
  });
});
