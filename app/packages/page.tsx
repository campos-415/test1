"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { daysLeft } from "@/lib/dogs";
import { todayKey } from "@/lib/dates";
import { packageTotals } from "@/lib/packageMoney";
import { ADDON_PRICES, PRICING } from "@/lib/pricing";
import { Dog, Package, PACKAGE_KINDS, PackageKind, PackageUse } from "@/types";
import { useSettings } from "@/components/SettingsProvider";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import { PackageRow } from "@/components/PackageBits";
import { useUnpaid } from "@/components/useUnpaid";
import useRole from "@/components/useRole";
import { isManagerOrAbove } from "@/lib/roles";
import { packageChargeKey } from "@/lib/billing";
import { activeDogs } from "@/lib/retire";

export default function PackagesPage() {
  return (
    <StaffGate title="Staff packages">
      <Packages />
    </StaffGate>
  );
}

function Packages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [uses, setUses] = useState<PackageUse[]>([]);
  const [allDogs, setAllDogs] = useState<Dog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  // A package sale is a charge like any other, so it can be outstanding.
  const { stateFor } = useUnpaid();
  // Selling and deleting packages are manager actions in the policy matrix.
  const { account, unavailable: rolesUnavailable } = useRole();
  const mayManage = rolesUnavailable || isManagerOrAbove(account?.role ?? null);

  // New-package form: look the number up, then pick which dogs it's for.
  const [phone, setPhone] = useState("");
  const { settings } = useSettings();
  // What's being sold. Tiers, the unit word, and the saved row all key off it.
  const [kind, setKind] = useState<PackageKind>("daycare");
  const tiers = settings.packageTiers.filter((t) => (t.kind ?? "daycare") === kind);
  const unit = kind === "walk" ? "walks" : "days";
  const [days, setDays] = useState(10);
  // What the client paid. Kept as a string so the field can start empty
  // rather than showing a misleading 0.
  const [price, setPrice] = useState("");
  // True when staff are entering a one-off outside the configured tiers.
  const [custom, setCustom] = useState(false);

  // Preselect the first tier once settings land, so the common case is one
  // tap — but never stomp on a choice already made.
  useEffect(() => {
    if (custom || !tiers.length) return;
    setDays(tiers[0].days);
    setPrice(String(tiers[0].price));
    // Keyed on kind so switching between daycare and walks re-seeds the
    // default rather than leaving the previous kind's price in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, settings.packageTiers]);
  const [dogMatches, setDogMatches] = useState<Dog[]>([]);
  const [dogsLoading, setDogsLoading] = useState(false);
  const [dogsChecked, setDogsChecked] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // A shared package has no dog_name, so it covers every dog on the number.
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTotal, setEditTotal] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [pkgRes, useRes, dogRes] = await Promise.all([
        supabase.from("packages").select("*").order("created_at", { ascending: false }),
        // A daycare spending twenty package days a week crosses a thousand
        // uses in a year, and the history below would start showing the wrong
        // rows with nothing to say it had.
        supabase.from("package_uses").select("*").order("used_on", { ascending: false }).limit(100000),
        supabase.from("dogs").select("*"),
      ]);
      if (pkgRes.error) throw pkgRes.error;
      if (useRes.error) throw useRes.error;
      if (dogRes.error) throw dogRes.error;
      setPackages((pkgRes.data as Package[]) ?? []);
      setUses((useRes.data as PackageUse[]) ?? []);
      setAllDogs((dogRes.data as Dog[]) ?? []);
    } catch (e) {
      console.error("Loading packages failed:", e);
      setError("Could not load packages.");
    } finally {
      setLoading(false);
    }
  }

  // Same debounced phone lookup the boarding page uses, so staff never
  // retype a client's name to sell them a package.
  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    setSelectedIds([]);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setDogMatches([]);
      setDogsChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setDogsLoading(true);
      try {
        const supabase = getSupabase();
        const { data, error: err } = await supabase
          .from("dogs")
          .select("*")
          .eq("phone", phone.trim())
          .order("created_at", { ascending: true });
        if (err) throw err;
        // A package is bought for a dog that is still coming.
        const found = activeDogs((data as Dog[]) ?? []);
        setDogMatches(found);
        if (found.length === 1 && found[0].id) setSelectedIds([found[0].id]);
      } catch (e) {
        console.error("Dog lookup failed:", e);
      } finally {
        setDogsLoading(false);
        setDogsChecked(true);
      }
    }, 400);
  }, [phone]);

  const selectedDogs = dogMatches.filter((c) => c.id && selectedIds.includes(c.id));

  function toggleDog(id?: string) {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function addPackages() {
    if (!phone.trim() || days < 1) {
      setError("Enter a phone number and how many days the package covers.");
      return;
    }
    if (!shared && selectedDogs.length === 0) {
      setError("Pick which dog (or dogs) this package is for — or mark it shared.");
      return;
    }
    const parsedPrice = price.trim() === "" ? null : parseFloat(price);
    if (parsedPrice === null || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      setError("Enter what the client paid for the package — that's the day's revenue for it.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const supabase = getSupabase();
      // The owner surname on file is the closest thing to a client name;
      // it's only used as a label on the list.
      const clientName = dogMatches[0]?.last_name?.trim() || phone.trim();
      const rows: {
        client_name: string;
        dog_name: string | null;
        phone: string;
        total_days: number;
        days_used: number;
        price: number;
        kind: PackageKind;
      }[] = shared
        ? [
            {
              client_name: clientName,
              dog_name: null,
              phone: phone.trim(),
              total_days: days,
              days_used: 0,
              price: parsedPrice,
              kind,
            },
          ]
        : selectedDogs.map((d) => ({
            client_name: d.last_name?.trim() || clientName,
            dog_name: d.dog_name,
            phone: phone.trim(),
            total_days: days,
            days_used: 0,
            // Price is per package, so two dogs each getting their own
            // package is two sales at this amount.
            price: parsedPrice,
            kind,
          }));
      const { error: err } = await supabase.from("packages").insert(rows);
      if (err) throw err;
      setPhone("");
      // Back to the default tier rather than a hardcoded 10 days, so the
      // next sale starts from the configured price list.
      setCustom(false);
      setDays(tiers[0]?.days ?? 10);
      setPrice(tiers[0] ? String(tiers[0].price) : "");
      setSelectedIds([]);
      setShared(false);
      setDogMatches([]);
      setDogsChecked(false);
      load();
    } catch (e) {
      console.error("Adding package failed:", e);
      setError("Could not save the package.");
    } finally {
      setSaving(false);
    }
  }

  // `delta` is how many days to CONSUME — negative gives one back.
  async function adjustUsed(pkg: Package, delta: number) {
    if (!pkg.id) return;
    const next = Math.max(0, Math.min(pkg.total_days, pkg.days_used + delta));
    if (next === pkg.days_used) return;
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").update({ days_used: next }).eq("id", pkg.id);
      if (err) throw err;

      // Keep the ledger in step with the counter so the history stays honest.
      if (delta > 0) {
        await supabase.from("package_uses").insert({
          package_id: pkg.id,
          dog_name: pkg.dog_name ?? null,
          used_on: todayKey(),
        });
      } else {
        const newest = uses
          .filter((u) => u.package_id === pkg.id)
          .sort((a, b) => b.used_on.localeCompare(a.used_on))[0];
        if (newest?.id) await supabase.from("package_uses").delete().eq("id", newest.id);
      }
      load();
    } catch (e) {
      console.error("Updating package failed:", e);
      setError("Could not update that package.");
    }
  }

  async function saveEditTotal(pkg: Package) {
    if (!pkg.id) return;
    const nextTotal = Math.max(1, editTotal);
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase
        .from("packages")
        .update({ total_days: nextTotal, days_used: Math.min(pkg.days_used, nextTotal) })
        .eq("id", pkg.id);
      if (err) throw err;
      setEditingId(null);
      load();
    } catch (e) {
      console.error("Updating package total failed:", e);
      setError("Could not update that package.");
    }
  }

  async function deletePackage(pkg: Package) {
    if (!pkg.id) return;
    const label = pkg.dog_name ? `${pkg.client_name} · ${pkg.dog_name}` : pkg.client_name;
    if (!window.confirm(`Delete the package for ${label}? This can't be undone.`)) return;
    setDeletingId(pkg.id);
    setError("");
    try {
      const supabase = getSupabase();
      const { error: err } = await supabase.from("packages").delete().eq("id", pkg.id);
      if (err) throw err;
      load();
    } catch (e) {
      console.error("Deleting package failed:", e);
      setError("Could not delete the package.");
    } finally {
      setDeletingId(null);
    }
  }

  const usesByPackage = useMemo(() => {
    const map = new Map<string, PackageUse[]>();
    for (const u of uses) {
      const list = map.get(u.package_id) ?? [];
      list.push(u);
      map.set(u.package_id, list);
    }
    return map;
  }, [uses]);

  // Phone digits, owner name or dog name. It used to be digits only, which
  // meant knowing a dog by name was no help in finding their package.
  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return packages;
    const digits = q.replace(/\D/g, "");
    return packages.filter(
      (p) =>
        (digits.length > 0 && p.phone.replace(/\D/g, "").includes(digits)) ||
        p.client_name.toLowerCase().includes(q) ||
        (p.dog_name ?? "").toLowerCase().includes(q)
    );
  }, [packages, search]);

  // The book as a whole, never the search results — the totals describe the
  // business, and quietly rescoping them to whatever is typed in a filter box
  // is how a number ends up in a report meaning something it does not mean.
  const totals = useMemo(
    () =>
      packageTotals(packages, new Date(), {
        daycare: PRICING.daycareFullDay,
        walk: ADDON_PRICES.walk,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packages, settings]
  );

  // One card per phone number. A family with a shared package and a couple of
  // per-dog ones was three unrelated rows that happened to sort together.
  const households = useMemo(() => {
    const byPhone = new Map<string, { phone: string; name: string; packages: Package[] }>();
    for (const pkg of filteredPackages) {
      const key = pkg.phone.replace(/\D/g, "") || pkg.phone;
      const found = byPhone.get(key) ?? { phone: pkg.phone, name: pkg.client_name, packages: [] };
      found.packages.push(pkg);
      byPhone.set(key, found);
    }
    return [...byPhone.values()];
  }, [filteredPackages]);

  const activeHouseholds = useMemo(
    () =>
      households
        .map((h) => ({ ...h, packages: h.packages.filter((p) => daysLeft(p) > 0) }))
        .filter((h) => h.packages.length > 0),
    [households]
  );
  const usedUp = filteredPackages.filter((p) => daysLeft(p) <= 0);

  const rowProps = {
    allDogs,
    usesByPackage,
    editingId,
    setEditingId,
    editTotal,
    setEditTotal,
    saveEditTotal,
    adjustUsed,
    deletePackage,
    deletingId,
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <StaffNav current="/packages" />
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-xl font-semibold text-ink">Daycare packages</h1>
        {/* What the front desk needs from a total: how many are live. The
            money — sold this month, and the value of days bought and not yet
            taken — is in Settings, Reports, with the rest of the money. It is
            an owner's number, and on a page used all day it invited questions
            nobody at the desk should have to field. */}
        <p className="text-xs text-ink-3">
          {totals.active.count} active · {totals.active.split.daycare} daycare ·{" "}
          {totals.active.split.walk} walk
        </p>
      </div>

      <div className="mb-8 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <p className="mb-4 text-sm font-medium text-ink-2">Sell a package</p>

        <div className="max-w-xs">
          <label className="mb-1 block text-[11px] text-ink-3">Phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            className={inputClass}
          />
        </div>

        {/* Tiers come from /settings, so the price list is set once rather
            than retyped per sale. Custom covers the odd one-off. */}
        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-ink-3">What are they buying?</label>
          <div className="flex flex-wrap gap-2">
            {PACKAGE_KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => {
                  setKind(k.key);
                  setCustom(false);
                }}
                className={`rounded-full border px-4 py-1.5 text-xs font-medium transition ${
                  kind === k.key
                    ? "border-accent-500 bg-accent-500 text-accent-ink"
                    : "border-line bg-surface text-ink-3 hover:border-line"
                }`}
              >
                {k.icon} {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-[11px] text-ink-3">Package</label>
          <div className="flex flex-wrap gap-2">
            {tiers.map((t) => {
              const active = !custom && days === t.days && price === String(t.price);
              return (
                <button
                  key={t.days}
                  type="button"
                  onClick={() => {
                    setCustom(false);
                    setDays(t.days);
                    setPrice(String(t.price));
                  }}
                  className={`rounded-2xl border px-4 py-2.5 text-left transition ${
                    active
                      ? "border-accent-500 bg-accent-50"
                      : "border-line bg-surface hover:border-line"
                  }`}
                >
                  <span
                    className={`block text-sm font-medium ${active ? "text-accent-700" : "text-ink-2"}`}
                  >
                    {t.days} {unit}
                  </span>
                  <span className="block text-xs text-emerald-700">${t.price.toFixed(2)}</span>
                  <span className="block text-[10px] text-ink-3">
                    ${(t.price / t.days).toFixed(2)}/{unit.slice(0, -1)}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setCustom(true)}
              className={`rounded-2xl border px-4 py-2.5 text-sm font-medium transition ${
                custom
                  ? "border-accent-500 bg-accent-50 text-accent-700"
                  : "border-line bg-surface text-ink-3 hover:border-line"
              }`}
            >
              Custom…
            </button>
          </div>
          {tiers.length === 0 && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              No package tiers configured yet —{" "}
              <Link href="/settings" className="font-medium text-accent-600 hover:underline">
                add them in Settings
              </Link>
              .
            </p>
          )}
        </div>

        {custom && (
          <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-ink-3">
              {kind === "walk" ? "Walks" : "Days"}
            </label>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-ink-3">Price paid</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="600.00"
                className={inputClass}
              />
            </div>
          </div>
        )}

        {/* The sale is the revenue event, so it has to be recorded here —
            the visits this package covers are $0 later on. */}
        <p className="mt-2 text-[11px] text-ink-3">
          The price counts as revenue on the day the package is sold. Visits it covers are then $0,
          since the money was already taken here.
          {days > 0 && price.trim() !== "" && !Number.isNaN(parseFloat(price)) && (
            <>
              {" "}
              <span className="font-medium text-ink-3">
                ${(parseFloat(price) / days).toFixed(2)} per day
              </span>{" "}
              vs ${(kind === "walk" ? ADDON_PRICES.walk : PRICING.daycareFullDay).toFixed(2)} each.
            </>
          )}
        </p>

        {dogsLoading && <p className="mt-2 text-xs text-ink-3">Looking up…</p>}

        {!dogsLoading && dogsChecked && dogMatches.length === 0 && (
          <p className="mt-2 text-xs text-amber-700">
            No dog on file for that number — the client needs an approved enrollment first.
          </p>
        )}

        {dogMatches.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] text-ink-3">
              {shared
                ? "Shared package — covers every dog on this number"
                : "Who is this package for? Tap all that apply."}
            </p>
            <div className="flex flex-wrap gap-2">
              {dogMatches.map((c) => {
                const isSelected = !!c.id && selectedIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={shared}
                    onClick={() => toggleDog(c.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                      isSelected && !shared
                        ? "border-accent-500 bg-accent-500 text-accent-ink"
                        : "border-accent-100 bg-surface text-accent-700 hover:border-accent-400"
                    }`}
                  >
                    {isSelected && !shared ? "✓ " : "🐕 "}
                    {c.dog_name} · {c.last_name}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-ink-3">
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => setShared(e.target.checked)}
                className="rounded border-line"
              />
              One shared package across every dog on this number
            </label>
          </div>
        )}

        <button
          onClick={addPackages}
          disabled={saving}
          className="mt-4 rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:opacity-60"
        >
          {saving
            ? "Saving…"
            : shared
              ? "Add shared package"
              : selectedDogs.length > 1
                ? `Add ${selectedDogs.length} packages`
                : "Add package"}
        </button>
        {error && <p className="mt-3 text-xs font-medium text-rose-500">{error}</p>}
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by dog, owner or phone…"
              className="w-full max-w-xs rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            />
            {search && (
              <span className="whitespace-nowrap text-xs text-ink-3">
                {filteredPackages.length} of {packages.length}
              </span>
            )}
          </div>

          <p className="mb-2 text-sm font-medium text-ink-2">Active packages</p>
          <div className="mb-8 space-y-2">
            {activeHouseholds.map((h) => (
              <div
                key={h.phone}
                className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <p className="min-w-0 truncate text-sm font-medium text-ink">
                    {h.name}
                    <span className="ml-1.5 font-normal text-ink-3">· {h.phone}</span>
                  </p>
                  {h.packages.length > 1 && (
                    <span className="shrink-0 text-[11px] text-ink-3">
                      {h.packages.length} packages
                    </span>
                  )}
                </div>
                {h.packages.map((p) => (
                  <PackageRow key={p.id} pkg={p} {...rowProps} mayManage={mayManage} payState={stateFor(packageChargeKey(p.id ?? ""))} />
                ))}
              </div>
            ))}
            {activeHouseholds.length === 0 && (
              <p className="text-sm text-ink-3">No active packages.</p>
            )}
          </div>

          {usedUp.length > 0 && (
            <details>
              <summary className="mb-3 cursor-pointer text-sm font-medium text-ink-3">
                Used-up packages ({usedUp.length})
              </summary>
              <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                {usedUp.map((p) => (
                  <PackageRow
                    key={p.id}
                    pkg={p}
                    {...rowProps}
                    showOwner
                    mayManage={mayManage}
                    payState={stateFor(packageChargeKey(p.id ?? ""))}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
