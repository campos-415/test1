"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { todayKey } from "@/lib/dates";
import { columnsOf, downloadCsv, stampedName, toCsv } from "@/lib/csv";
import {
  AccountRow,
  ExportDataset,
  ExportRefused,
  ReportData,
  accountRows,
  dogDirectoryRows,
  exportDataset,
  loadReportData,
  moneySummary,
  outstandingChargeRows,
  recordExport,
} from "@/lib/reports";
import { packageTotals } from "@/lib/packageMoney";
import { StorageHealth, formatBytes, loadStorageHealth } from "@/lib/storageHealth";
import { ADDON_PRICES, PRICING } from "@/lib/pricing";
import { logRefusal } from "@/lib/audit";
import { canExport } from "@/lib/roles";
import useRole from "@/components/useRole";
import CardTable from "@/components/CardTable";

// Settings -> Reports.
//
// Two different things staff mean by "a report", kept apart because they are
// used differently:
//
//   Printed  — a page already in the app, opened and printed for a shift or a
//              client. Links, not duplicates: the day report knows how to
//              print itself, and a second implementation here would drift.
//   Exported — a spreadsheet. Everything on file, for the questions nobody
//              anticipated, and for the ones about money.
//
// Who sees which is a role question now. An employee gets the printable
// reports, which are pages they can already open, and does not get the money
// or the spreadsheets: requirement 3 says downloading the client database
// needs specific authorisation, and aggregate receivables are the business
// owner's figures rather than a shift's.
//
// The interface hiding them is not the control. Every download below goes
// through a function in the database that refuses anybody below manager and
// records the export in the audit log, so the answer is the same for
// somebody who bypasses this screen entirely.

const money = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function ReportsSection() {
  const [date, setDate] = useState(todayKey());
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const checkHealth = useCallback(() => {
    setHealthLoading(true);
    loadStorageHealth()
      .then(setHealth)
      .catch((e) => console.error("Measuring storage failed:", e))
      .finally(() => setHealthLoading(false));
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);
  const [busyExport, setBusyExport] = useState("");
  const { account, loading: roleLoading, unavailable: rolesUnavailable } = useRole();

  // A database that has not run the security migrations has no roles to
  // read, and behaving as though everybody is an employee would take the
  // reports away from the owner on the strength of a missing table.
  const mayExport = rolesUnavailable || canExport(account?.role ?? null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadReportData());
    } catch (e) {
      console.error("Loading report data failed:", e);
      setError("Could not load the records. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Not fetched at all without the authorisation to use it. Skipping it
    // saves an employee a large download of records they cannot export
    // anyway, and means the screen does not hold what it will not show.
    if (roleLoading || !mayExport) return;
    load();
  }, [load, roleLoading, mayExport]);

  const accounts = useMemo(() => (data ? accountRows(data) : []), [data]);
  const summary = useMemo(() => moneySummary(accounts), [accounts]);

  // Package money belongs with the rest of the money rather than on the
  // packages page, which is a front-desk tool — staff there need to know how
  // many days a dog has left, not what the business is carrying. The report
  // data already includes packages, so this costs nothing extra.
  const pkgs = useMemo(
    () =>
      data
        ? packageTotals(data.packages, new Date(), {
            daycare: PRICING.daycareFullDay,
            walk: ADDON_PRICES.walk,
          })
        : null,
    [data]
  );

  function write(stem: string, rows: Record<string, unknown>[]) {
    downloadCsv(stampedName(stem), toCsv(rows, columnsOf(rows)));
    setNote(`Downloaded ${stem} — ${rows.length.toLocaleString()} rows.`);
  }

  /**
   * A refusal from the database. Shown as it arrived - those messages are
   * written for a person - and recorded, because somebody below manager
   * trying to download the client list is worth a line in the log even
   * though it did not succeed.
   */
  async function refused(what: string, e: unknown) {
    const message =
      e instanceof ExportRefused ? e.message : "Could not export. Check the connection and try again.";
    setError(message);
    setNote("");
    if (e instanceof ExportRefused) await logRefusal(`export ${what}`, message);
    else console.error(`Exporting ${what} failed:`, e);
  }

  /**
   * The rows an export used to be built from, straight out of what is already
   * loaded. Used only on a database where the security migrations have not
   * been run, so this screen keeps working exactly as it did before them
   * rather than telling staff that exports are not set up.
   *
   * This is not a way round the gate. It is reached only when the whole
   * security layer is absent - no staff_roles table, so no roles to enforce -
   * which is the state the app was already in. Once the migrations are run,
   * staff_roles exists, rolesUnavailable goes false, and every export goes
   * through the database.
   */
  function legacyRows(dataset: ExportDataset): Record<string, unknown>[] {
    if (!data) return [];
    const byDataset: Record<ExportDataset, Record<string, unknown>[]> = {
      dogs: data.dogs as unknown as Record<string, unknown>[],
      owners: data.owners,
      visits: data.signins as unknown as Record<string, unknown>[],
      boardings: data.boardings as unknown as Record<string, unknown>[],
      packages: data.packages as unknown as Record<string, unknown>[],
      payments: data.payments as unknown as Record<string, unknown>[],
      vaccinations: data.vaccinations as unknown as Record<string, unknown>[],
      walk_logs: data.walkLogs as unknown as Record<string, unknown>[],
    };
    return byDataset[dataset] ?? [];
  }

  /** A table, fetched through the gate that authorises reading it in bulk. */
  async function saveTable(stem: string, dataset: ExportDataset) {
    setBusyExport(stem);
    setError("");
    setNote("");
    try {
      const rows = rolesUnavailable ? legacyRows(dataset) : await exportDataset(dataset);
      if (!rows.length) {
        setNote("Nothing to export there yet.");
        return;
      }
      write(stem, rows);
    } catch (e) {
      await refused(dataset, e);
    } finally {
      setBusyExport("");
    }
  }

  /** One of the three the browser works out for itself. */
  async function saveComposed(stem: string, rows: Record<string, unknown>[]) {
    setBusyExport(stem);
    setError("");
    setNote("");
    try {
      if (!rows.length) {
        setNote("Nothing to export there yet.");
        return;
      }
      // Authorised and recorded before a file reaches the downloads folder.
      // Skipped only where there is no security layer to consult - see
      // legacyRows above.
      if (!rolesUnavailable) await recordExport(stem, rows.length);
      write(stem, rows);
    } catch (e) {
      await refused(stem, e);
    } finally {
      setBusyExport("");
    }
  }

  const owing = accounts.filter((a) => a.outstanding > 0.005);
  const credits = accounts.filter((a) => a.outstanding < -0.005);

  return (
    <div className="space-y-5">
      {/* ---------- printable ---------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink">🖨️ Printable reports</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          Each opens the page it belongs to, laid out for paper. Use the browser&rsquo;s print
          dialogue to print or save as PDF.
        </p>

        <div className="mt-3 max-w-[13rem]">
          <label className="mb-1 block text-[11px] text-ink-3">Date for the daily reports</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayKey())}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent-500"
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ReportLink
            href={`/day-report?date=${date}`}
            title="End-of-day report"
            blurb="Revenue by category, service counts and the day's total."
          />
          <ReportLink
            href={`/in-house?date=${date}`}
            title="Sign-in list"
            blurb="Who was in, times, add-ons, package and price."
          />
          <ReportLink
            href={`/in-house?date=${date}&view=walklog`}
            title="Walk log"
            blurb="Every walk owed that day, daycare and boarding."
          />
          <ReportLink
            href="/calendar"
            title="Boarding calendar"
            blurb="Stays and meet & greets across the month."
          />
          <ReportLink
            href="/stay-report"
            title="Boarding stay report"
            blurb="One sheet per stay: feeding, medication, walk and meal logs."
          />
          <ReportLink
            href="/packages"
            title="Packages"
            blurb="Blocks on file with days used against days bought."
          />
        </div>
      </section>

      {/* ---------- not authorised for the rest ---------- */}
      {!mayExport && !roleLoading && (
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h3 className="text-sm font-semibold text-ink">🔒 Money and spreadsheets</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-3">
            Balances across the business, and the CSV downloads of clients, dogs, visits and
            payments, need a manager or owner account. Downloading the client list is the kind of
            thing that should be a decision rather than a click, so the database asks who is doing
            it and records the answer.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            What you can still do here: every printable report above, and a household&rsquo;s own
            balance from their page when they are paying.
          </p>
        </section>
      )}

      {/* ---------- money ---------- */}
      {mayExport && (
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">💰 Money owed</h3>
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent-300 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-ink-3">
          Balances are per household — one family pays one bill covering every dog on the number.
          Payments settle the oldest charge first, which is what makes &ldquo;days overdue&rdquo;
          meaningful.
        </p>

        {loading && !data ? (
          <p className="mt-3 text-sm text-ink-3">Adding it up…</p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Outstanding" value={money(summary.totalOutstanding)} tone="rose" />
              <Stat label="Credit held" value={money(summary.totalCredit)} tone="emerald" />
              <Stat label="Charged all time" value={money(summary.totalCharged)} />
              <Stat label="Paid all time" value={money(summary.totalPaid)} />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Stat label="0–30 days" value={money(summary.current)} small />
              <Stat label="31–60 days" value={money(summary.days31to60)} small />
              <Stat label="61–90 days" value={money(summary.days61to90)} small />
              <Stat label="Over 90 days" value={money(summary.over90)} small tone="rose" />
            </div>

            <p className="mt-2 text-[11px] text-ink-3">
              {summary.households.toLocaleString()} households · {owing.length} owing ·{" "}
              {credits.length} in credit · {summary.settled} settled
            </p>

            {pkgs && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Packages
                </p>
                {/* The count under each figure. "$325 sold" is three ten-day
                    blocks or one big one, and which it is changes what the
                    number means — one household on a annual block is not the
                    same business as three families buying in. */}
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat
                    label="Sold this month"
                    value={money(pkgs.sold.amount)}
                    sub={packageCount(pkgs.sold.count)}
                  />
                  <Stat
                    label="Sold last month"
                    value={money(pkgs.soldPrev.amount)}
                    sub={packageCount(pkgs.soldPrev.count)}
                  />
                  <Stat
                    label="Unredeemed"
                    value={money(pkgs.unredeemed.amount)}
                    // Active packages, not packages ever sold: an exhausted
                    // block owes nothing and has no business inflating this.
                    sub={`${packageCount(pkgs.active.count)} still open`}
                    tone="amber"
                  />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  Unredeemed runs the other way from the balances above: it is money already taken
                  for service not yet given. A package is revenue on the day it is sold, so the
                  visits it later covers are $0 — until they are taken, the days sit here.
                  {pkgs.unredeemed.amount > 0 && (
                    <>
                      {" "}
                      {unusedUnits(pkgs)} outstanding, valued at what each client paid. The same
                      days at walk-in rates would be {money(pkgs.unredeemed.atWalkIn)}, so the
                      packages discount them by{" "}
                      {money(pkgs.unredeemed.atWalkIn - pkgs.unredeemed.amount)}.
                    </>
                  )}
                  {pkgs.unredeemed.unpriced > 0 && (
                    <span className="text-amber-700">
                      {" "}
                      {pkgs.unredeemed.unpriced === 1
                        ? "1 active package predates price recording, so its days are excluded from the figure above."
                        : `${pkgs.unredeemed.unpriced} active packages predate price recording, so their days are excluded from the figure above.`}
                    </span>
                  )}
                </p>
              </div>
            )}

            {owing.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <CardTable className="w-full min-w-[34rem] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-line text-ink-3">
                      <th className="py-1.5 pr-3 font-medium">Household</th>
                      <th className="py-1.5 pr-3 font-medium">Dogs</th>
                      <th className="py-1.5 pr-3 font-medium">Oldest unpaid</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owing.slice(0, 12).map((a) => (
                      <tr key={a.phone} className="border-b border-line-soft text-ink-2">
                        <td className="py-1.5 pr-3">
                          <Link
                            href={`/owners/${encodeURIComponent(a.phone)}`}
                            className="font-medium text-accent-600 hover:underline"
                          >
                            {a.owner || a.phone}
                          </Link>
                          <span className="block text-[10px] text-ink-3">{a.phone}</span>
                        </td>
                        <td className="py-1.5 pr-3">{a.dogs}</td>
                        <td className="whitespace-nowrap py-1.5 pr-3">
                          {a.oldestUnpaidDate || "—"}
                          {a.daysOverdue > 0 && (
                            <span
                              className={`ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold ${
                                a.daysOverdue > 90
                                  ? "bg-rose-100 text-rose-700"
                                  : a.daysOverdue > 30
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-surface-3 text-ink-3"
                              }`}
                            >
                              {a.daysOverdue}d
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold text-rose-600">
                          {money(a.outstanding)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CardTable>
                {owing.length > 12 && (
                  <p className="mt-1.5 text-[11px] text-ink-3">
                    Showing the 12 largest of {owing.length}. The export has them all.
                  </p>
                )}
              </div>
            )}

            {credits.length > 0 && (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900">
                {credits.length} household{credits.length === 1 ? "" : "s"} in credit —{" "}
                {credits
                  .slice(0, 4)
                  .map((c) => `${c.owner || c.phone} ${money(-c.outstanding)}`)
                  .join(", ")}
                {credits.length > 4 ? ", …" : ""}. Credit is an overpayment carried forward; it
                comes off their next visit automatically.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Download
                label="Accounts + ageing"
                busy={busyExport === "accounts-receivable"}
                onClick={() =>
                  saveComposed(
                    "accounts-receivable",
                    accounts as unknown as Record<string, unknown>[]
                  )
                }
              />
              <Download
                label="Outstanding charges"
                busy={busyExport === "outstanding-charges"}
                onClick={() => data && saveComposed("outstanding-charges", outstandingChargeRows(data))}
              />
              <Download
                label="Payments received"
                busy={busyExport === "payments"}
                onClick={() => saveTable("payments", "payments")}
              />
            </div>
          </>
        )}
      </section>
      )}

      {/* ---------- storage ---------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">💾 Storage health</h3>
          <button
            onClick={checkHealth}
            disabled={healthLoading}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:border-accent-400 disabled:opacity-60">
            {healthLoading ? "Measuring…" : "Re-check"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-ink-3">
          Records are cheap; pictures are not. Photos, signed waivers and uploaded vaccination
          records are stored inside the rows themselves, so they are what eventually fills the
          database — and the first sign is usually pages getting slow, not an error.
        </p>

        {!health ? (
          <p className="mt-3 text-sm text-ink-3">Measuring…</p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Stat label="Records" value={health.totalRows.toLocaleString()} />
              <Stat
                label="Pictures (estimated)"
                value={formatBytes(health.totalBlobBytes)}
                tone={health.totalBlobBytes > health.limitBytes * 0.6 ? "amber" : undefined}
              />
              <Stat
                label="Of the 500 MB free tier"
                value={`${Math.min(100, Math.round((health.totalBlobBytes / health.limitBytes) * 100))}%`}
                tone={health.totalBlobBytes > health.limitBytes * 0.6 ? "amber" : undefined}
              />
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full ${
                  health.totalBlobBytes > health.limitBytes * 0.6 ? "bg-amber-400" : "bg-accent-500"
                }`}
                style={{
                  width: `${Math.min(100, (health.totalBlobBytes / health.limitBytes) * 100)}%`,
                }}
              />
            </div>

            <div className="mt-3 overflow-x-auto">
              <CardTable className="w-full min-w-[30rem] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th className="py-1.5 pr-3 font-medium">Table</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Records</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Pictures</th>
                    <th className="py-1.5 pr-3 font-medium">Sampled</th>
                  </tr>
                </thead>
                <tbody>
                  {health.tables.map((t) => (
                    <tr key={t.table} className="border-b border-line-soft text-ink-2">
                      <td className="py-1.5 pr-3">{t.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {t.rows.toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {t.blobBytes > 0 ? formatBytes(t.blobBytes) : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-[11px] text-ink-3">
                        {t.sampleSize > 0
                          ? `${t.sampleWithBlob} of ${t.sampleSize} had one`
                          : "no pictures"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </CardTable>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Picture sizes are an estimate: a sample of {12} rows per table, averaged across all of
              them. Measuring exactly would mean downloading every image, which is the thing this is
              here to warn about. Expect it to drift while only a few dogs have photos.
              {health.totalBlobBytes > health.limitBytes * 0.6 && (
                <span className="font-medium text-amber-700">
                  {" "}
                  Past about 60% it is worth moving pictures to file storage rather than paying for
                  a bigger database — they are the only thing that grows this fast.
                </span>
              )}
            </p>
          </>
        )}
      </section>

      {/* ---------- spreadsheets ---------- */}
      {mayExport && (
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold text-ink">📄 Spreadsheets</h3>
        <p className="mt-0.5 text-xs text-ink-3">
          CSV, opens in Excel, Numbers or Google Sheets. Photos and signatures are left out —
          they are megabytes of encoded image and unreadable in a spreadsheet.
        </p>

        <div className="mt-3 space-y-2">
          <ExportRow
            title="Dogs and owners — everything on file"
            blurb="One row per dog: every profile answer, vaccination dates and status, age, visit counts, package balances, plus the whole owner record — address, email, emergency and vet contacts."
            count={data?.dogs.length}
            busy={busyExport === "dogs-and-owners"}
            onClick={() => data && saveComposed("dogs-and-owners", dogDirectoryRows(data))}
          />
          <ExportRow
            title="Owners"
            blurb="One row per household, with dogs and balance."
            count={data?.owners.length}
            busy={busyExport === "owners"}
            onClick={() =>
              data &&
              saveComposed(
                "owners",
                data.owners.map((o) => {
                  const acct = accounts.find((a) => a.phone === o.phone);
                  return {
                    ...o,
                    dogs: data.dogs
                      .filter((d) => d.phone === o.phone)
                      .map((d) => d.dog_name)
                      .join("; "),
                    outstanding: acct?.outstanding ?? 0,
                    charged: acct?.charged ?? 0,
                    paid: acct?.paid ?? 0,
                  };
                })
              )
            }
          />
          <ExportRow
            title="Visits"
            blurb="Every sign-in and sign-out with service, add-ons, who handed over and price."
            count={data?.signins.length}
            busy={busyExport === "visits"}
            onClick={() => saveTable("visits", "visits")}
          />
          <ExportRow
            title="Boarding reservations"
            blurb="Dates, add-ons, walks per day, feeding and medication instructions."
            count={data?.boardings.length}
            busy={busyExport === "boardings"}
            onClick={() => saveTable("boardings", "boardings")}
          />
          <ExportRow
            title="Packages"
            blurb="Blocks sold, kind, days used against days bought and price."
            count={data?.packages.length}
            busy={busyExport === "packages"}
            onClick={() => saveTable("packages", "packages")}
          />
          <ExportRow
            title="Walk logs"
            blurb="Per dog, per day, per slot — out, back and who walked."
            count={data?.walkLogs.length}
            busy={busyExport === "walk-logs"}
            onClick={() => saveTable("walk-logs", "walk_logs")}
          />
          <ExportRow
            title="Vaccinations"
            blurb="Every record with given and expiry dates."
            count={data?.vaccinations.length}
            busy={busyExport === "vaccinations"}
            onClick={() => saveTable("vaccinations", "vaccinations")}
          />
        </div>

        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          These files contain client names, phone numbers, addresses and emergency contacts. Treat a
          download like a printed client list — keep it off shared drives and delete it when the job
          is done. Every download is recorded against your account in Settings → Security.
        </p>
      </section>
      )}

      {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
      {note && <p className="text-xs font-medium text-emerald-700">{note}</p>}
    </div>
  );
}

function ReportLink({ href, title, blurb }: { href: string; title: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 transition hover:border-accent-300"
    >
      <p className="text-sm font-medium text-ink">{title} →</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{blurb}</p>
    </Link>
  );
}

function unusedUnits(t: ReturnType<typeof packageTotals>): string {
  return (
    [
      t.unredeemed.units.daycare > 0 &&
        `${t.unredeemed.units.daycare} daycare day${t.unredeemed.units.daycare === 1 ? "" : "s"}`,
      t.unredeemed.units.walk > 0 &&
        `${t.unredeemed.units.walk} walk${t.unredeemed.units.walk === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" and ") || "Nothing"
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  small,
}: {
  label: string;
  value: string;
  /** The count behind the money — how many things make up the figure above. */
  sub?: string;
  tone?: "rose" | "emerald" | "amber";
  small?: boolean;
}) {
  const colour =
    tone === "rose"
      ? "text-rose-600"
      : tone === "emerald"
        ? "text-emerald-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`${small ? "text-sm" : "text-lg"} font-semibold ${colour}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-ink-3">{sub}</p>}
    </div>
  );
}

/** "1 package" / "3 packages" — the count under a money figure. */
function packageCount(n: number): string {
  return `${n.toLocaleString()} package${n === 1 ? "" : "s"}`;
}

function Download({
  label,
  onClick,
  busy,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent-300 disabled:opacity-60"
    >
      {busy ? "Preparing…" : `⬇ ${label}`}
    </button>
  );
}

function ExportRow({
  title,
  blurb,
  count,
  onClick,
  busy,
}: {
  title: string;
  blurb: string;
  count?: number;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{blurb}</p>
      </div>
      <button
        onClick={onClick}
        disabled={count === 0 || busy}
        className="shrink-0 rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-50"
      >
        {busy ? (
          "Preparing…"
        ) : (
          <>
            ⬇ CSV
            {count != null && <span className="ml-1 opacity-80">({count.toLocaleString()})</span>}
          </>
        )}
      </button>
    </div>
  );
}
