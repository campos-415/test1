"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CustomerGate from "@/components/CustomerGate";
import {
  HouseholdData,
  daysRemaining,
  householdBalance,
  loadHouseholdData,
  nextStay,
} from "@/lib/customer";
import { prettyDateKey, todayKey } from "@/lib/dates";
import { VACCINES, VaccineKey } from "@/types";

export default function AccountPage() {
  return <CustomerGate>{() => <Overview />}</CustomerGate>;
}

function Overview() {
  const [data, setData] = useState<HouseholdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadHouseholdData());
      setError("");
    } catch (e) {
      console.error("Loading the household failed:", e);
      setError("We could not load your records just now. Try again in a moment.");
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
  const stay = nextStay(data.stays, today);
  const packages = data.packages.filter((p) => daysRemaining(p) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {data.household.owner_name ? `Hello, ${firstName(data.household.owner_name)}` : "Hello"}
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {data.dogs.length === 1
            ? `Everything we hold for ${data.dogs[0].dog_name}.`
            : `Everything we hold for your ${data.dogs.length} dogs.`}
        </p>
      </div>

      {/* Three numbers, because they are the three questions people ring up
          to ask: when are they next in, how many days are left, what do I
          owe. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Next stay"
          value={stay ? prettyDateKey(stay.start_date) : "None booked"}
          hint={stay ? `${stay.dog_name} · to ${prettyDateKey(stay.end_date)}` : "Request one below"}
        />
        <Tile
          label="Package days left"
          value={
            packages.length
              ? String(packages.reduce((sum, p) => sum + daysRemaining(p), 0))
              : "None"
          }
          hint={packages.length ? packages.map((p) => p.dog_name || "Shared").join(", ") : "Ask us about a block"}
        />
        <Tile
          label={balance.outstanding > 0 ? "Outstanding" : "Balance"}
          value={
            balance.outstanding > 0.005
              ? `$${balance.outstanding.toFixed(2)}`
              : balance.outstanding < -0.005
                ? `$${Math.abs(balance.outstanding).toFixed(2)} in credit`
                : "Settled"
          }
          hint={balance.outstanding > 0.005 ? "Payable at pick-up" : "Nothing due"}
          tone={balance.outstanding > 0.005 ? "alert" : "default"}
        />
      </div>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
          Your dogs
        </h2>
        <div className="space-y-3">
          {data.dogs.map((dog) => (
            <DogCard
              key={dog.id}
              dog={dog}
              vaccinations={data.vaccinations.filter((v) => v.dog_id === dog.id)}
              today={today}
            />
          ))}
          {!data.dogs.length && (
            <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-ink-3">
              We do not have a dog on file for you yet. Give us a ring if that looks wrong.
            </p>
          )}
          <Link
            href="/account/dogs/new"
            className="block rounded-2xl border border-dashed border-line px-4 py-3 text-center text-sm font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
          >
            + Add another dog
          </Link>
        </div>
      </section>

      {data.requests.some((r) => r.status === "pending") && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            You have a boarding request waiting on us.
          </p>
          <ul className="mt-1 space-y-0.5">
            {data.requests
              .filter((r) => r.status === "pending")
              .map((r) => (
                <li key={r.id} className="text-xs text-amber-800">
                  {r.dog_names.join(", ")} · {prettyDateKey(r.start_date)} to{" "}
                  {prettyDateKey(r.end_date)} — not booked until we confirm by email.
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href="/account/boarding"
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
        >
          Request a boarding stay
        </Link>
        <Link
          href="/account/documents"
          className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-300"
        >
          Send us a vaccination record
        </Link>
      </div>
    </div>
  );
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function Tile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "alert";
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 shadow-card ${
        tone === "alert" ? "border-amber-200 bg-amber-50/70" : "border-line bg-surface"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p
        className={`mt-1 font-display text-lg font-semibold ${
          tone === "alert" ? "text-amber-900" : "text-ink"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

/**
 * One dog, with the state of its vaccinations.
 *
 * The expiry is the thing worth surfacing: a dog cannot come in on out of
 * date paperwork, and finding that out at the door is worse for everybody
 * than finding it out here.
 */
function DogCard({
  dog,
  vaccinations,
  today,
}: {
  dog: { id?: string; dog_name: string; breed?: string | null; photo_data?: string | null };
  vaccinations: { vaccine: VaccineKey; expires_on?: string | null }[];
  today: string;
}) {
  const expired = vaccinations.filter((v) => v.expires_on && v.expires_on < today);
  const soon = vaccinations.filter(
    (v) => v.expires_on && v.expires_on >= today && v.expires_on <= addDays(today, 30)
  );

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      {dog.photo_data ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dog.photo_data}
          alt={dog.dog_name}
          className="h-14 w-14 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
          🐕
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display text-base font-semibold text-ink">{dog.dog_name}</p>
        {dog.breed && <p className="text-xs text-ink-3">{dog.breed}</p>}

        {expired.length > 0 ? (
          <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700">
            {labelFor(expired)} out of date.{" "}
            <Link href="/account/documents" className="underline">
              Send us the new record
            </Link>
          </p>
        ) : soon.length > 0 ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            {labelFor(soon)} due within the month.
          </p>
        ) : vaccinations.length ? (
          <p className="mt-2 text-xs text-emerald-700">Vaccinations up to date.</p>
        ) : (
          <p className="mt-2 text-xs text-ink-3">No vaccination dates on file.</p>
        )}
      </div>
    </div>
  );
}

function labelFor(list: { vaccine: VaccineKey }[]): string {
  const names = list.map((v) => VACCINES.find((x) => x.key === v.vaccine)?.label ?? v.vaccine);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
