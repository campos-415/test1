"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { Category, DailyInput, computeDailyTotals, loadDailyData } from "@/lib/daily";
import { SignInRecord } from "@/types";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import DogSearch from "@/components/DogSearch";
import BarChart from "@/components/BarChart";

export default function DashboardPage() {
  return (
    <StaffGate title="Staff dashboard">
      <Dashboard />
    </StaffGate>
  );
}

// Everywhere staff can go. Profiles are missing on purpose — those are
// reached by searching a dog or clicking a name.
const DESTINATIONS: { href: string; icon: string; label: string; blurb: string }[] = [
  { href: "/in-house", icon: "📋", label: "In house", blurb: "Sign-in list, walk log, edits" },
  {
    href: "/in-house?desk=1",
    icon: "🚗",
    label: "Front desk",
    blurb: "Sign a dog in or out for a client",
  },
  { href: "/calendar", icon: "🗓️", label: "Boarding calendar", blurb: "Reservations, stays and meet & greets" },
  { href: "/packages", icon: "📦", label: "Packages", blurb: "Sell and track package days" },
  { href: "/day-report", icon: "📊", label: "End-of-day report", blurb: "Printable revenue totals" },
  { href: "/signup", icon: "✍️", label: "New client signup", blurb: "Enrollment form at the desk" },
  {
    href: "/requests",
    icon: "📥",
    label: "Requests",
    blurb: "Approve new clients and boarding dates",
  },
];

function Dashboard() {
  const router = useRouter();
  const today = todayKey();
  // Held whole so the totals see the date they were loaded for.
  const [data, setData] = useState<DailyInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loadDailyData(today));
    } catch (e) {
      console.error("Loading dashboard failed:", e);
      setError("Could not load today's numbers.");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () =>
      computeDailyTotals(
        data ?? {
          signins: [],
          boardings: [],
          packageUses: [],
          packagesSold: [],
          selectedDate: today,
        }
      ),
    [data, today]
  );

  // Dogs still on site: dropped off today with no pick-up after it.
  const stillHere = useMemo(() => {
    const lastAction = new Map<string, SignInRecord>();
    for (const s of [...(data?.signins ?? [])].sort(
      (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
    )) {
      if (s.dog_id) lastAction.set(s.dog_id, s);
    }
    return Array.from(lastAction.values()).filter((s) => s.action === "drop_off");
  }, [data]);

  function openService(category: Category) {
    if (!category.service) return;
    router.push(`/in-house?date=${today}&service=${category.service}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <StaffNav current="/dashboard" />

      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-ink">Today</h1>
        <p className="text-sm text-ink-3">{prettyDateKey(today)}</p>
      </div>

      {/* Search sits at the top — it's the fastest way to anything. */}
      <div className="mb-6">
        <DogSearch />
      </div>

      {error && <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>}

      {/* Headline numbers — deliberately no money here. Revenue is on the
          printable /daily report, so a lobby-facing screen never shows it. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="In House"
          value={String(stillHere.length)}
          accent
          href={`/in-house?date=${today}`}
        />
        <Stat label="Still to arrive" value={String(totals.scheduledToArrive)} />
        <Stat
          label="Dropped off"
          value={String(totals.dropOffs.length)}
          href={`/in-house?date=${today}`}
        />
        <Stat
          label="Picked up"
          value={String(totals.pickUps.length)}
          href={`/in-house?date=${today}`}
        />
      </div>

      {/* The day's report, front and centre. */}
      <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            What&apos;s on today
          </h2>
          {/* <Link href="/day-report" className="text-xs font-medium text-accent-600 hover:underline">
            Revenue &amp; printable report →
          </Link> */}
        </div>

        {loading ? (
          <p className="text-sm text-ink-3">Loading…</p>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Services scheduled
            </p>
            <BarChart data={totals.scheduled} format={(n) => String(n)} />

            <p className="mb-1.5 mt-5 text-[11px] font-medium uppercase tracking-wide text-ink-3">
              Dogs by service
            </p>
            <BarChart data={totals.dogsByService} format={(n) => String(n)} onSelect={openService} />

            <p className="mt-3 text-[11px] text-ink-3">
              Counts of work booked for today — walks and medications for every stay covering today,
              grooming on the day a boarding dog goes home. Tap a service to open its sign-in list.
            </p>
          </>
        )}
      </section>

      {/* Everywhere else */}
      <section className="mb-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Everything else
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DESTINATIONS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:border-accent-300"
            >
              <p className="text-sm font-medium text-ink">
                <span className="mr-1.5">{d.icon}</span>
                {d.label}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">{d.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  href,
}: {
  label: string;
  value: string;
  accent?: boolean;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className={`text-xl font-semibold ${accent ? "text-emerald-700" : "text-ink"}`}>
        {value}
      </p>
    </>
  );
  const className = `block rounded-2xl border border-line bg-surface px-4 py-3 shadow-card${
    href ? " transition hover:border-accent-300" : ""
  }`;
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
