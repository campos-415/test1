import { describe, expect, it } from "vitest";
import { ReportData, accountRows, moneySummary, outstandingChargeRows } from "@/lib/reports";
import { todayKey } from "@/lib/dates";
import { Dog, Package, Payment, SignInRecord } from "@/types";

// The money reports — the accounts export, the ageing buckets, and the chase
// list. This is what the owner reads when deciding who to ring, so the two
// things that must hold are that a household's debt lands in the right bucket
// and that credit is never quietly counted as debt.

/** A day key n days before today, so ageing cases do not rot. */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A priced pick-up, which is what creates a charge. */
const charge = (id: string, dayKey: string, price: number, phone = "(415) 555-0000") =>
  ({
    id,
    phone,
    dog_name: "Buki",
    action: "pick_up",
    service_type: "daycare",
    price,
    // Local noon, so the local day key is unambiguous whatever the timezone.
    created_at: new Date(`${dayKey}T12:00:00`).toISOString(),
  }) as SignInRecord;

const paid = (amount: number, dayKey: string, phone = "(415) 555-0000") =>
  ({ phone, amount, paid_on: dayKey }) as Payment;

const dog = (phone: string, dog_name: string, last_name = "Campos") =>
  ({ phone, dog_name, last_name }) as Dog;

const data = (over: Partial<ReportData>): ReportData => ({
  dogs: [],
  owners: [],
  signins: [],
  boardings: [],
  packages: [],
  payments: [],
  vaccinations: [],
  walkLogs: [],
  ...over,
});

describe("accountRows", () => {
  it("makes one row per household, covering every dog on the number", () => {
    // Balances are per household: one family pays one bill.
    const rows = accountRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki"), dog("(415) 555-0000", "Koda")],
        signins: [charge("a", daysAgo(1), 70)],
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].dogs).toBe("Buki; Koda");
  });

  it("ages each unpaid charge into the right bucket", () => {
    const rows = accountRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki")],
        signins: [
          charge("now", daysAgo(5), 10),
          charge("mid", daysAgo(45), 20),
          charge("old", daysAgo(75), 30),
          charge("ancient", daysAgo(200), 40),
        ],
      })
    );
    const r = rows[0];
    expect(r.current).toBe(10);
    expect(r.days31to60).toBe(20);
    expect(r.days61to90).toBe(30);
    expect(r.over90).toBe(40);
    expect(r.outstanding).toBe(100);
  });

  it("settles the oldest charge first, so days overdue means something", () => {
    // 100 charged 200 days ago and 50 charged yesterday, with 100 paid. The
    // old debt is the one that clears; what is left is recent.
    const rows = accountRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki")],
        signins: [charge("old", daysAgo(200), 100), charge("new", daysAgo(1), 50)],
        payments: [paid(100, todayKey())],
      })
    );
    const r = rows[0];
    expect(r.outstanding).toBe(50);
    expect(r.over90).toBe(0);
    expect(r.current).toBe(50);
    expect(r.daysOverdue).toBeLessThanOrEqual(1);
  });

  it("reports overpayment as a negative balance rather than as debt", () => {
    const rows = accountRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki")],
        signins: [charge("a", daysAgo(2), 70)],
        payments: [paid(100, todayKey())],
      })
    );
    expect(rows[0].outstanding).toBe(-30);
    // And nothing lands in an ageing bucket: they owe nothing.
    expect(rows[0].current).toBe(0);
  });

  it("includes a household that has only ever paid, or only bought a package", () => {
    // Built from dogs, payments AND packages, so a client with no visits yet
    // still appears rather than vanishing from the accounts export.
    const rows = accountRows(
      data({
        payments: [paid(50, todayKey(), "(415) 555-1111")],
        packages: [
          {
            id: "p",
            phone: "(415) 555-2222",
            dog_name: "Rex",
            total_days: 10,
            days_used: 0,
            price: 500,
            kind: "daycare",
            created_at: new Date().toISOString(),
          } as Package,
        ],
      })
    );
    expect(rows.map((r) => r.phone).sort()).toEqual(["(415) 555-1111", "(415) 555-2222"]);
  });

  it("puts the biggest debt first — the order anybody chasing money wants", () => {
    const rows = accountRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki"), dog("(415) 555-9999", "Rex")],
        signins: [
          charge("small", daysAgo(3), 20, "(415) 555-0000"),
          charge("big", daysAgo(3), 500, "(415) 555-9999"),
        ],
      })
    );
    expect(rows[0].phone).toBe("(415) 555-9999");
  });
});

describe("moneySummary", () => {
  const rows = accountRows(
    data({
      dogs: [
        dog("(415) 555-0001", "A"),
        dog("(415) 555-0002", "B"),
        dog("(415) 555-0003", "C"),
      ],
      signins: [
        charge("owes", daysAgo(10), 100, "(415) 555-0001"),
        charge("settled", daysAgo(10), 50, "(415) 555-0002"),
        charge("credit", daysAgo(10), 20, "(415) 555-0003"),
      ],
      payments: [
        paid(50, todayKey(), "(415) 555-0002"),
        paid(70, todayKey(), "(415) 555-0003"),
      ],
    })
  );

  it("counts owing, settled and in-credit households separately", () => {
    const s = moneySummary(rows);
    expect(s.households).toBe(3);
    expect(s.owing).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.inCredit).toBe(1);
  });

  it("reports credit as a positive number, the way a front desk says it", () => {
    const s = moneySummary(rows);
    expect(s.totalCredit).toBe(50); // 20 charged, 70 paid
    // And credit does not cancel out somebody else's debt in the headline.
    expect(s.totalOutstanding).toBe(100);
  });

  it("adds up to the same money as the rows it came from", () => {
    const s = moneySummary(rows);
    expect(s.totalCharged).toBe(170);
    expect(s.totalPaid).toBe(120);
  });

  it("returns zeroes for an empty book rather than NaN", () => {
    const s = moneySummary([]);
    expect(s.households).toBe(0);
    expect(s.totalOutstanding).toBe(0);
    expect(Number.isNaN(s.totalCharged)).toBe(false);
  });
});

describe("outstandingChargeRows", () => {
  it("lists only what is still unpaid", () => {
    const rows = outstandingChargeRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki")],
        signins: [charge("old", daysAgo(100), 70), charge("new", daysAgo(1), 30)],
        payments: [paid(70, todayKey())],
      })
    );
    // The old one is settled; only the recent charge should be chased.
    expect(rows).toHaveLength(1);
  });

  it("is empty when everybody is square", () => {
    const rows = outstandingChargeRows(
      data({
        dogs: [dog("(415) 555-0000", "Buki")],
        signins: [charge("a", daysAgo(5), 70)],
        payments: [paid(70, todayKey())],
      })
    );
    expect(rows).toHaveLength(0);
  });
});
