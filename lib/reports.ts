// The data behind Settings -> Reports.
//
// Two jobs: flatten a table into something a spreadsheet can hold, and work
// out where the money is. Balances are per PHONE, because one household pays
// one bill covering every dog on the number (see lib/billing.ts).

import { getSupabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

/** Only the ordering helper is needed off the query builder. */
type Ordered = { order: (column: string) => unknown };
import { computeBalance, unpaidCharges } from "@/lib/billing";
import { todayKey } from "@/lib/dates";
import { ageFromBirthdate } from "@/lib/enrollment";
import { daysLeft, packageKind } from "@/lib/dogs";
import { overallVaccineStatus, STATUS_LABELS } from "@/lib/vaccines";
import { Boarding, Dog, Package, Payment, SignInRecord, Vaccination, WalkLog } from "@/types";

/** Everything the reports need, fetched once. */
export interface ReportData {
  dogs: Dog[];
  owners: Record<string, unknown>[];
  signins: SignInRecord[];
  boardings: Boarding[];
  packages: Package[];
  payments: Payment[];
  vaccinations: Vaccination[];
  walkLogs: WalkLog[];
}

export async function loadReportData(): Promise<ReportData> {
  // Paged, not capped.
  //
  // These were written as generous limits — 5,000 dogs, 20,000 sign-ins — on
  // the assumption that asking for more than a thousand rows gets you more
  // than a thousand rows. It does not: PostgREST caps the response at 1,000
  // whatever the client asks for, so a limit of 20,000 and a limit of 1,000
  // return exactly the same truncated set, silently and with no error.
  //
  // This database already holds 2,640 vaccination records, so the export was
  // quietly shipping 1,000 of them. Range paging is the only thing that
  // actually reads a whole table.
  const [dogs, owners, signins, boardings, packages, payments, vaccinations, walkLogs] =
    await Promise.all([
      fetchAll<Dog>("dogs", "*", (q) => (q as never as Ordered).order("dog_name")),
      fetchAll<Record<string, unknown>>("owners"),
      fetchAll<SignInRecord>("signins"),
      fetchAll<Boarding>("boardings"),
      fetchAll<Package>("packages"),
      fetchAll<Payment>("payments"),
      fetchAll<Vaccination>("vaccinations"),
      fetchAll<WalkLog>("walk_logs"),
    ]);

  return {
    dogs,
    owners,
    signins,
    boardings,
    packages,
    payments,
    vaccinations,
    walkLogs,
  };
}

// ---------------------------------------------------------------------
// Exporting, which is a different question from reading.
//
// Requirement 3 says an employee must not be able to export the whole
// customer database without specific authorisation. That is enforced in the
// database, not here: both functions below call into
// security-exports-migration.sql, which refuses anybody below manager and
// writes a line in the audit log naming the person, the dataset and the
// number of rows. Hiding the buttons in the interface is a courtesy on top,
// so nobody is offered something that will fail.
//
// Two paths, because there are two kinds of export:
//
//   exportDataset  a table, fetched through the gate. The function is the
//                  authorisation for reading it in bulk.
//   recordExport   the three exports composed in the browser out of figures
//                  already on screen - accounts and ageing, outstanding
//                  charges, the dog directory. Their arithmetic lives in
//                  lib/billing.ts and above, and reimplementing it in SQL
//                  would leave two versions of the same sums to drift apart.
//                  So this authorises and records the act instead.
// ---------------------------------------------------------------------

/** The datasets the database will hand over in bulk. */
export type ExportDataset =
  | "dogs"
  | "owners"
  | "visits"
  | "boardings"
  | "packages"
  | "payments"
  | "vaccinations"
  | "walk_logs";

/**
 * Thrown when the database refuses an export. The message comes from the
 * database and is already written for a person to read, so it is shown as
 * it arrives rather than replaced with something vaguer.
 */
export class ExportRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRefused";
  }
}

/**
 * How many rows one request can actually carry.
 *
 * PostgREST caps a response at 1,000 rows whatever is asked for, and the cap
 * applies to a function returning a set just as it does to a table. Asking for
 * more does not fail, it silently returns a thousand — so an export of a 2,640
 * row table produced a spreadsheet that looked complete and was not. The rows
 * are fetched a page at a time for that reason and for no other.
 */
const EXPORT_PAGE = 1000;

/**
 * A safety valve, not a business limit. Nothing here is near it: the largest
 * table in the app is a few thousand rows. It exists so that a bug which stops
 * the pages from advancing cannot spin forever in somebody's browser.
 */
const EXPORT_MAX_ROWS = 250_000;

export async function exportDataset(kind: ExportDataset): Promise<Record<string, unknown>[]> {
  const supabase = getSupabase();
  const rows: Record<string, unknown>[] = [];

  for (let offset = 0; ; offset += EXPORT_PAGE) {
    const { data, error } = await supabase.rpc("export_dataset", {
      p_dataset: kind,
      p_offset: offset,
      p_limit: EXPORT_PAGE,
    });
    if (error) throw new ExportRefused(exportMessage(error.message));

    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);

    // A short page is the end. Asking again would cost a request to be told
    // the same thing.
    if (page.length < EXPORT_PAGE) break;

    if (rows.length >= EXPORT_MAX_ROWS) {
      console.error(`Export of ${kind} stopped at ${rows.length} rows, which should not happen.`);
      break;
    }
  }

  return rows;
}

export async function recordExport(kind: string, rows: number): Promise<void> {
  const { error } = await getSupabase().rpc("record_export", {
    p_dataset: kind,
    p_rows: rows,
  });
  if (error) throw new ExportRefused(exportMessage(error.message));
}

function exportMessage(raw: string): string {
  // Before the migration has been run the function does not exist, and the
  // PostgREST message for that is not one to show a member of staff.
  if (/could not find the function|does not exist|schema cache/i.test(raw)) {
    return "Exports are not set up on this database yet. Run the security migrations first.";
  }
  return raw;
}

// ---------------------------------------------------------------------
// The directory: every dog, with its household attached.
// ---------------------------------------------------------------------

/**
 * One row per dog, carrying every column on the dog AND every column on its
 * owner, plus the derived facts staff would otherwise work out by hand.
 *
 * Owner columns are prefixed so `notes` on a dog and `notes` on an owner do
 * not collide into one column and lose whichever came second.
 */
export function dogDirectoryRows(data: ReportData): Record<string, unknown>[] {
  const ownerByPhone = new Map<string, Record<string, unknown>>();
  for (const o of data.owners) ownerByPhone.set(String(o.phone ?? ""), o);

  const vaccinesByDog = new Map<string, Vaccination[]>();
  for (const v of data.vaccinations) {
    if (!v.dog_id) continue;
    const list = vaccinesByDog.get(v.dog_id) ?? [];
    list.push(v);
    vaccinesByDog.set(v.dog_id, list);
  }

  const visitsByDog = new Map<string, SignInRecord[]>();
  for (const s of data.signins) {
    if (!s.dog_id) continue;
    const list = visitsByDog.get(s.dog_id) ?? [];
    list.push(s);
    visitsByDog.set(s.dog_id, list);
  }

  return data.dogs.map((dog) => {
    const owner = ownerByPhone.get(dog.phone) ?? {};
    const vaccines = dog.id ? (vaccinesByDog.get(dog.id) ?? []) : [];
    const visits = dog.id ? (visitsByDog.get(dog.id) ?? []) : [];
    const dropOffs = visits.filter((v) => v.action === "drop_off");
    const blocks = data.packages.filter(
      (p) =>
        p.phone === dog.phone &&
        (!p.dog_name || p.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase())
    );

    const row: Record<string, unknown> = {};
    // Dog columns first, verbatim — photo and signature blobs are dropped by
    // the CSV layer rather than here, so nothing is lost for other callers.
    for (const [k, v] of Object.entries(dog)) row[k] = v;

    // Derived, so a spreadsheet does not need formulas to be useful.
    row.age = ageFromBirthdate(dog.birthdate ?? "");
    row.vaccination_status = vaccines.length ? STATUS_LABELS[overallVaccineStatus(vaccines)] : "No record";
    for (const v of vaccines) {
      row[`vaccine_${v.vaccine}_given`] = v.given_on ?? "";
      row[`vaccine_${v.vaccine}_expires`] = v.expires_on ?? "";
    }
    row.total_visits = dropOffs.length;
    row.first_visit = dropOffs.length ? dropOffs[dropOffs.length - 1].created_at?.slice(0, 10) : "";
    row.last_visit = dropOffs.length ? dropOffs[0].created_at?.slice(0, 10) : "";
    row.daycare_days_left = blocks
      .filter((p) => packageKind(p) === "daycare")
      .reduce((sum, p) => sum + daysLeft(p), 0);
    row.walk_credits_left = blocks
      .filter((p) => packageKind(p) === "walk")
      .reduce((sum, p) => sum + daysLeft(p), 0);
    row.upcoming_stays = data.boardings.filter(
      (b) => b.dog_id === dog.id && b.end_date >= todayKey()
    ).length;

    for (const [k, v] of Object.entries(owner)) {
      if (k === "phone" || k === "id") continue; // already on the dog
      row[`owner_${k}`] = v;
    }
    return row;
  });
}

// ---------------------------------------------------------------------
// The money.
// ---------------------------------------------------------------------

export interface AccountRow {
  phone: string;
  owner: string;
  dogs: string;
  charged: number;
  paid: number;
  /** Positive means they owe; negative means they are in credit. */
  outstanding: number;
  /** Blank when nothing is owed. */
  oldestUnpaidDate: string;
  daysOverdue: number;
  /** Ageing of what is owed, oldest charge first. */
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
  lastPaymentOn: string;
  lastPaymentAmount: number | "";
}

function daysBetween(from: string, to: string): number {
  if (!from) return 0;
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * One row per household, with what they owe aged into the usual buckets.
 *
 * Payments are not tied to a specific charge — money settles the account — so
 * they are applied oldest-charge-first, which is both the conventional
 * allocation and the one that makes "days overdue" mean something.
 */
export function accountRows(data: ReportData): AccountRow[] {
  const phones = new Set<string>();
  for (const d of data.dogs) if (d.phone) phones.add(d.phone);
  for (const p of data.payments) if (p.phone) phones.add(p.phone);
  for (const p of data.packages) if (p.phone) phones.add(p.phone);

  const today = todayKey();
  const rows: AccountRow[] = [];

  for (const phone of phones) {
    const signins = data.signins.filter((s) => s.phone === phone);
    const packages = data.packages.filter((p) => p.phone === phone);
    const payments = data.payments.filter((p) => p.phone === phone);
    const balance = computeBalance(signins, packages, payments);
    const unpaid = unpaidCharges(balance);

    const dogsOnNumber = data.dogs.filter((d) => d.phone === phone);
    const ownerRow = data.owners.find((o) => o.phone === phone);
    const ownerName =
      [ownerRow?.owner_name, dogsOnNumber[0]?.last_name].filter(Boolean).join(" ").trim() ||
      dogsOnNumber[0]?.last_name ||
      "";

    const buckets = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
    for (const c of unpaid) {
      const age = daysBetween(c.date, today);
      if (age <= 30) buckets.current += c.remaining;
      else if (age <= 60) buckets.days31to60 += c.remaining;
      else if (age <= 90) buckets.days61to90 += c.remaining;
      else buckets.over90 += c.remaining;
    }

    const oldest = unpaid.length ? unpaid[unpaid.length - 1] : null;
    const lastPayment = balance.payments[0];

    rows.push({
      phone,
      owner: ownerName,
      dogs: dogsOnNumber.map((d) => d.dog_name).join("; "),
      charged: round(balance.charged),
      paid: round(balance.paid),
      outstanding: balance.outstanding,
      oldestUnpaidDate: oldest?.date ?? "",
      daysOverdue: oldest ? daysBetween(oldest.date, today) : 0,
      current: round(buckets.current),
      days31to60: round(buckets.days31to60),
      days61to90: round(buckets.days61to90),
      over90: round(buckets.over90),
      lastPaymentOn: lastPayment?.paid_on ?? "",
      lastPaymentAmount: lastPayment ? round(lastPayment.amount ?? 0) : "",
    });
  }

  // Biggest debt first — that is the order anybody chasing money wants.
  return rows.sort((a, b) => b.outstanding - a.outstanding);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface MoneySummary {
  households: number;
  owing: number;
  inCredit: number;
  settled: number;
  totalCharged: number;
  totalPaid: number;
  totalOutstanding: number;
  totalCredit: number;
  current: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export function moneySummary(rows: AccountRow[]): MoneySummary {
  const s: MoneySummary = {
    households: rows.length,
    owing: 0,
    inCredit: 0,
    settled: 0,
    totalCharged: 0,
    totalPaid: 0,
    totalOutstanding: 0,
    totalCredit: 0,
    current: 0,
    days31to60: 0,
    days61to90: 0,
    over90: 0,
  };
  for (const r of rows) {
    s.totalCharged += r.charged;
    s.totalPaid += r.paid;
    if (r.outstanding > 0.005) {
      s.owing += 1;
      s.totalOutstanding += r.outstanding;
    } else if (r.outstanding < -0.005) {
      s.inCredit += 1;
      // Reported as a positive amount of credit held, which is how a front
      // desk talks about it.
      s.totalCredit += -r.outstanding;
    } else {
      s.settled += 1;
    }
    s.current += r.current;
    s.days31to60 += r.days31to60;
    s.days61to90 += r.days61to90;
    s.over90 += r.over90;
  }
  for (const k of [
    "totalCharged",
    "totalPaid",
    "totalOutstanding",
    "totalCredit",
    "current",
    "days31to60",
    "days61to90",
    "over90",
  ] as const) {
    s[k] = round(s[k]);
  }
  return s;
}

/** Every charge still unpaid, one row each — the chase list. */
export function outstandingChargeRows(data: ReportData): Record<string, unknown>[] {
  const today = todayKey();
  const out: Record<string, unknown>[] = [];
  const phones = new Set(data.dogs.map((d) => d.phone).filter(Boolean));
  for (const phone of phones) {
    const balance = computeBalance(
      data.signins.filter((s) => s.phone === phone),
      data.packages.filter((p) => p.phone === phone),
      data.payments.filter((p) => p.phone === phone)
    );
    const ownerRow = data.owners.find((o) => o.phone === phone);
    for (const c of unpaidCharges(balance)) {
      out.push({
        phone,
        owner: ownerRow?.owner_name ?? "",
        email: ownerRow?.email ?? "",
        charge_date: c.date,
        days_overdue: daysBetween(c.date, today),
        description: c.label,
        kind: c.kind,
        original_amount: round(c.amount),
        still_owed: round(c.remaining),
      });
    }
  }
  return out.sort((a, b) => String(a.charge_date).localeCompare(String(b.charge_date)));
}
