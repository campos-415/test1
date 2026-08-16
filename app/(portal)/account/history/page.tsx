"use client";

import { useCallback, useEffect, useState } from "react";
import CustomerGate from "@/components/CustomerGate";
import { HouseholdData, householdBalance, loadHouseholdData } from "@/lib/customer";
import { unpaidByKey, signinChargeKey, packageChargeKey } from "@/lib/billing";
import { prettyDateKey, todayKey } from "@/lib/dates";

export default function HistoryPage() {
  return <CustomerGate>{() => <History />}</CustomerGate>;
}

function History() {
  const [data, setData] = useState<HouseholdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadHouseholdData());
      setError("");
    } catch (e) {
      console.error("Loading the history failed:", e);
      setError("We could not load your history just now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;
  if (error) return <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>;
  if (!data) return null;

  const today = todayKey();
  const balance = householdBalance(data);
  // Which charges are still owed, and how much of each. Payments settle the
  // oldest charge first, so this is not a property of a charge on its own -
  // the same arithmetic the front desk uses, from the same function.
  const unpaid = unpaidByKey(balance);

  const upcoming = data.stays.filter((s) => s.end_date >= today);
  const past = data.stays.filter((s) => s.end_date < today);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Visits &amp; billing
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Everything on your account. Prices in amber are still outstanding.
        </p>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Account balance
          </span>
          <span
            className={`font-display text-xl font-semibold ${
              balance.outstanding > 0.005 ? "text-amber-700" : "text-ink"
            }`}
          >
            {balance.outstanding > 0.005
              ? `$${balance.outstanding.toFixed(2)} outstanding`
              : balance.outstanding < -0.005
                ? `$${Math.abs(balance.outstanding).toFixed(2)} in credit`
                : "Settled"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-3">
          ${balance.charged.toFixed(2)} charged · ${balance.paid.toFixed(2)} paid. Payment is taken
          at pick-up — there is nothing to pay online.
        </p>
      </section>

      {upcoming.length > 0 && (
        <Section title="Upcoming stays">
          {upcoming.map((s) => (
            <Row
              key={s.id}
              left={s.dog_name}
              middle={`${prettyDateKey(s.start_date)} → ${prettyDateKey(s.end_date)}`}
              right={s.addons?.length ? s.addons.join(", ") : ""}
            />
          ))}
        </Section>
      )}

      <Section title="Visits" empty="No visits on your account yet.">
        {data.visits
          .filter((v) => v.action === "pick_up")
          .map((v) => {
            const owed = unpaid.get(signinChargeKey(v.id ?? "")) ?? 0;
            return (
              <Row
                key={v.id}
                left={v.dog_name}
                middle={`${v.created_at ? prettyDateKey(v.created_at.slice(0, 10)) : ""} · ${String(
                  v.service_type ?? "visit"
                ).replace("_", " ")}`}
                right={
                  v.price == null ? (
                    <span className="text-ink-3">covered</span>
                  ) : (
                    <span className={owed > 0.005 ? "font-medium text-amber-700" : "text-ink-2"}>
                      ${v.price.toFixed(2)}
                    </span>
                  )
                }
              />
            );
          })}
      </Section>

      <Section title="Packages" empty="No packages bought.">
        {data.packages.map((p) => {
          const owed = unpaid.get(packageChargeKey(p.id ?? "")) ?? 0;
          return (
            <Row
              key={p.id}
              left={p.dog_name || "Shared"}
              middle={`${p.total_days} ${(p.kind ?? "daycare") === "walk" ? "walks" : "days"} · ${
                Math.max(0, p.total_days - p.days_used)
              } left`}
              right={
                p.price == null ? (
                  ""
                ) : (
                  <span className={owed > 0.005 ? "font-medium text-amber-700" : "text-ink-2"}>
                    ${p.price.toFixed(2)}
                  </span>
                )
              }
            />
          );
        })}
      </Section>

      <Section title="Payments received" empty="No payments recorded yet.">
        {data.payments.map((p) => (
          <Row
            key={p.id}
            left={p.method ? String(p.method) : "Payment"}
            middle={prettyDateKey(p.paid_on)}
            right={<span className="text-emerald-700">${p.amount.toFixed(2)}</span>}
          />
        ))}
      </Section>

      {past.length > 0 && (
        <Section title="Past stays">
          {past.map((s) => (
            <Row
              key={s.id}
              left={s.dog_name}
              middle={`${prettyDateKey(s.start_date)} → ${prettyDateKey(s.end_date)}`}
              right=""
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: string;
  children: React.ReactNode;
}) {
  const isEmpty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {isEmpty ? (
        <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-3">
          {empty}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({
  left,
  middle,
  right,
}: {
  left: string;
  middle: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-b-0">
      <span className="w-28 shrink-0 truncate font-medium text-ink">{left}</span>
      <span className="min-w-0 flex-1 truncate text-ink-3">{middle}</span>
      <span className="shrink-0 whitespace-nowrap">{right}</span>
    </div>
  );
}
