"use client";

import { useEffect, useRef, useState } from "react";
import { formatPhoneInput } from "@/lib/phone";
import {
  daysLeft,
  eligiblePackagesFor,
  findPackageFor,
  packageLabel,
  preferredPackageId,
} from "@/lib/dogs";
import { todayKey } from "@/lib/dates";
import SquarePayButton from "@/components/SquarePayButton";
import {
  OpenVisit,
  PhoneContext,
  loadPhoneContext,
  packageApplies,
  performSignIn,
  walkPackageApplies,
} from "@/lib/signin";
import {
  ADDONS,
  AddonKey,
  Boarding,
  Dog,
  PICKUP_WINDOWS,
  PACKAGE_KINDS,
  Package,
  PackageKind,
  SERVICE_TYPES,
  ServiceType,
  SignAction,
} from "@/types";

// Staff-side check-in/out, for when a client doesn't use the lobby kiosk.
// Writes through the same lib/signin.ts path the kiosk uses, so pricing and
// package deduction behave identically — the difference is that staff also
// choose which package a visit draws from, and the row is tagged by_staff.
export default function StaffCheckIn({ onDone }: { onDone?: () => void }) {
  const [phone, setPhone] = useState("");
  const [ctx, setCtx] = useState<PhoneContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [busyDogId, setBusyDogId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  // What these sign-outs came to. Collected so a household picking up two
  // dogs taps the card once, not twice.
  const [owed, setOwed] = useState<{ dogName: string; amount: number; label: string }[]>([]);

  // Per-dog choices, keyed by client id.
  const [serviceByDog, setServiceByDog] = useState<Record<string, ServiceType>>({});
  const [addonsByDog, setAddonsByDog] = useState<Record<string, AddonKey[]>>({});
  const [windowByDog, setWindowByDog] = useState<Record<string, string>>({});
  // Keyed "<dogId>|<kind>" — a dog can hold several daycare blocks and
  // several walk blocks, and each is chosen separately.
  const [packageByDog, setPackageByDog] = useState<Record<string, string>>({});

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setCtx(null);
      setChecked(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        setCtx(await loadPhoneContext(phone));
      } catch (e) {
        console.error("Staff lookup failed:", e);
        setError("Could not look up that number.");
      } finally {
        setLoading(false);
        setChecked(true);
      }
    }, 400);
  }, [phone]);

  function activeBoardingFor(dog: Dog): Boarding | null {
    if (!ctx) return null;
    const today = todayKey();
    return (
      ctx.boardings.find(
        (b) =>
          b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase() &&
          b.start_date <= today &&
          b.end_date >= today
      ) ?? null
    );
  }

  // A reserved dog is boarding whatever the selector says; otherwise it's
  // the staff pick, defaulting to daycare.
  function serviceFor(dog: Dog, open: OpenVisit | undefined): ServiceType {
    if (open) return open.serviceType; // pick-up is locked to how it came in
    if (activeBoardingFor(dog)) return "boarding";
    return (dog.id && serviceByDog[dog.id]) || "daycare";
  }

  function packagesFor(dog: Dog, kind: PackageKind = "daycare"): Package[] {
    return ctx ? eligiblePackagesFor(ctx.packages, phone.trim(), dog.dog_name, kind) : [];
  }

  // Did staff actually pick this block for this visit, rather than it being
  // the resolved default? Only a deliberate pick spends a day on a visit
  // under four hours — see packageApplies.
  function isExplicitPick(dog: Dog, kind: PackageKind = "daycare"): boolean {
    const id = dog.id ? packageByDog[`${dog.id}|${kind}`] : undefined;
    return !!id && packagesFor(dog, kind).some((p) => p.id === id);
  }

  // Whichever package staff picked for this dog and kind, else the default
  // (own before shared, days remaining before exhausted).
  function chosenPackage(dog: Dog, kind: PackageKind = "daycare"): Package | null {
    const eligible = packagesFor(dog, kind);
    // Staff's pick for this visit wins; otherwise the dog's pinned default;
    // otherwise the standard rule.
    const id = dog.id ? packageByDog[`${dog.id}|${kind}`] : undefined;
    const explicit = id && eligible.find((p) => p.id === id);
    if (explicit) return explicit;
    return findPackageFor(
      ctx?.packages ?? [],
      phone.trim(),
      dog.dog_name,
      kind,
      preferredPackageId(dog, kind)
    );
  }

  async function submit(dog: Dog, action: SignAction) {
    if (!dog.id || !ctx) return;
    const open = ctx.openVisits.get(dog.id);
    const service = serviceFor(dog, open);

    if (action === "drop_off" && service === "boarding" && !activeBoardingFor(dog)) {
      setError(`No reservation covering today for ${dog.dog_name} — add one on Boardings first.`);
      return;
    }
    setBusyDogId(dog.id);
    setError("");
    try {
      const addons = addonsByDog[dog.id] ?? [];
      const reservation = activeBoardingFor(dog);

      const result = await performSignIn({
        dog,
        action,
        serviceType: service,
        phone,
        byName: staffName.trim() || "Staff",
        addons: action === "drop_off" ? addons : [],
        pickupWindow: addons.includes("bath") ? (windowByDog[dog.id] ?? null) : null,
        // A booked stay already agreed the bath size, so it prices itself.
        bathSize: reservation?.bath_size ?? null,
        openVisit: open ?? null,
        pkg: chosenPackage(dog, "daycare"),
        pkgExplicit: isExplicitPick(dog, "daycare"),
        walkPkg: chosenPackage(dog, "walk"),
        byStaff: true,
      });
      setDone((prev) => [
        ...prev,
        result.alreadyClosed
          ? `${result.dogName} was already signed out${
              result.priceDue != null ? ` · $${result.priceDue.toFixed(2)} already charged` : ""
            } — nothing added`
          : `${result.dogName} ${action === "drop_off" ? "signed in" : "signed out"}${
              result.priceDue != null ? ` · $${result.priceDue.toFixed(2)} due` : ""
            }${result.usedPackage ? " · package day used" : ""}${
              result.usedWalkPackage ? " · walk from package" : ""
            }`,
      ]);
      // An already-closed visit must not join the "Due now" list: its charge is
      // already on the books, and adding it again would inflate the amount the
      // pay button hands to Square.
      if (!result.alreadyClosed && action === "pick_up" && (result.priceDue ?? 0) > 0) {
        setOwed((prev) => [
          ...prev,
          { dogName: result.dogName, amount: result.priceDue!, label: result.priceLabel ?? "Visit" },
        ]);
      }
      // Reload so the dog's status, and any package it just spent a day
      // from, reflect what was written.
      setCtx(await loadPhoneContext(phone));
      onDone?.();
    } catch (e) {
      console.error("Staff sign-in failed:", e);
      setError("Could not save that — check the connection and try again.");
    } finally {
      setBusyDogId(null);
    }
  }

  const dogs = ctx?.dogs ?? [];
  const now = new Date();

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] text-ink-3">Client phone number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-3">Your name (recorded on the visit)</label>
          <input
            value={staffName}
            onChange={(e) => setStaffName(e.target.value)}
            placeholder="Staff member"
            className={inputClass}
          />
        </div>
      </div>

      {loading && <p className="mt-2 text-xs text-ink-3">Looking up…</p>}
      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
      {!loading && checked && dogs.length === 0 && (
        <p className="mt-2 text-xs text-amber-700">No dogs on file for that number.</p>
      )}

      {done.length > 0 && (
        <ul className="mt-3 space-y-1">
          {done.map((d, i) => (
            <li key={i} className="text-xs font-medium text-emerald-700">
              ✓ {d}
            </li>
          ))}
        </ul>
      )}

      {owed.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Due now</p>
          <ul className="mt-1.5 space-y-0.5">
            {owed.map((o, i) => (
              <li key={i} className="flex justify-between text-xs text-ink-2">
                <span>
                  {o.dogName} · {o.label}
                </span>
                <span className="font-medium">${o.amount.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-2">
            <span className="text-sm font-semibold text-ink">
              Total ${owed.reduce((sum, o) => sum + o.amount, 0).toFixed(2)}
            </span>
            <span className="ml-auto">
              <SquarePayButton
                amount={owed.reduce((sum, o) => sum + o.amount, 0)}
                note={owed.map((o) => `${o.dogName}: ${o.label}`).join(" | ")}
                phone={phone.trim()}
                dogNames={owed.map((o) => o.dogName)}
                returnTo="/in-house?desk=1"
              />
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Or take cash and record it on the owner profile — this only handles the card.
          </p>
        </div>
      )}

      {dogs.length > 0 && (
        <div className="mt-4 space-y-3">
          {dogs.map((dog) => {
            const open = dog.id ? ctx?.openVisits.get(dog.id) : undefined;
            const isIn = !!open;
            const service = serviceFor(dog, open);
            const serviceMeta = SERVICE_TYPES.find((s) => s.key === service);
            const pkg = chosenPackage(dog, "daycare");
            const walkPkg = chosenPackage(dog, "walk");
            const willUsePackage =
              isIn && packageApplies(service, open, pkg, now, isExplicitPick(dog, "daycare"));
            // A walk package covers the daycare walk add-on only; a stay's
            // walks bill per walk on the reservation — see performSignIn.
            const willUseWalk =
              isIn && service !== "boarding" && walkPackageApplies(open, walkPkg);
            const addons = (dog.id && addonsByDog[dog.id]) || [];
            const reservation = activeBoardingFor(dog);

            return (
              <div key={dog.id} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {dog.photo_data ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dog.photo_data} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-base">
                      🐕
                    </span>
                  )}
                  <p className="text-sm font-medium text-ink">
                    {dog.dog_name} <span className="font-normal text-ink-3">· {dog.last_name}</span>
                  </p>
                  {isIn ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      🟢 In · {serviceMeta?.label}
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-2">
                      Out
                    </span>
                  )}
                  {!isIn && reservation && (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                      🛏️ Reserved today
                    </span>
                  )}
                </div>

                {/* Drop-off options. A pick-up is locked to how the dog came
                    in, so none of this applies then. */}
                {!isIn && (
                  <>
                    {!reservation && (
                      <div className="mb-2">
                        <label className="mb-1 block text-[11px] text-ink-3">Service</label>
                        <div className="flex flex-wrap gap-1.5">
                          {SERVICE_TYPES.map((s) => (
                            <button
                              key={s.key}
                              onClick={() =>
                                dog.id &&
                                setServiceByDog((prev) => ({ ...prev, [dog.id!]: s.key }))
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                service === s.key
                                  ? "border-accent-500 bg-accent-50 text-accent-700"
                                  : "border-line bg-surface text-ink-3 hover:border-line"
                              }`}
                            >
                              {s.icon} {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="mb-1 block text-[11px] text-ink-3">Add-ons</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ADDONS.map((a) => (
                        <button
                          key={a.key}
                          onClick={() =>
                            dog.id &&
                            setAddonsByDog((prev) => {
                              const cur = prev[dog.id!] ?? [];
                              return {
                                ...prev,
                                [dog.id!]: cur.includes(a.key)
                                  ? cur.filter((x) => x !== a.key)
                                  : [...cur, a.key],
                              };
                            })
                          }
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            addons.includes(a.key)
                              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                              : "border-line bg-surface text-ink-3 hover:border-line"
                          }`}
                        >
                          {a.icon} {a.label}
                        </button>
                      ))}
                    </div>

                    {addons.includes("bath") && (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] text-ink-3">
                          Pick-up window for the bath
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {PICKUP_WINDOWS.map((w) => (
                            <button
                              key={w}
                              onClick={() =>
                                dog.id && setWindowByDog((prev) => ({ ...prev, [dog.id!]: w }))
                              }
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                dog.id && windowByDog[dog.id] === w
                                  ? "border-sky-500 bg-sky-50 text-sky-700"
                                  : "border-line bg-surface text-ink-3 hover:border-line"
                              }`}
                            >
                              {w}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Package choice — staff-only, which is why it lives here
                    and not on the parent-facing kiosk. One picker per kind:
                    a household can hold several daycare blocks and several
                    walk blocks, and a visit can draw from one of each. */}
                {PACKAGE_KINDS.map((k) => {
                  const eligible = packagesFor(dog, k.key);
                  if (!eligible.length) return null;
                  const chosen = k.key === "walk" ? walkPkg : pkg;
                  if (!chosen) return null;
                  const willUse = k.key === "walk" ? willUseWalk : willUsePackage;
                  // What signing out now would leave on the block. Counted
                  // against the picked block only, so switching between two
                  // blocks visibly moves the use rather than spending both.
                  const held = willUse ? 1 : 0;
                  return (
                    <div key={k.key} className="mt-2">
                      <label className="mb-1 block text-[11px] text-ink-3">
                        {k.icon} {k.label} package{eligible.length > 1 ? " to draw from" : ""}
                      </label>
                      {eligible.length > 1 ? (
                        <select
                          value={chosen.id ?? ""}
                          onChange={(e) =>
                            dog.id &&
                            setPackageByDog((prev) => ({
                              ...prev,
                              [`${dog.id}|${k.key}`]: e.target.value,
                            }))
                          }
                          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent-500"
                        >
                          {eligible.map((p) => (
                            <option key={p.id} value={p.id ?? ""} disabled={daysLeft(p) === 0}>
                              {packageLabel(p, p.id === chosen.id ? held : 0)}
                              {daysLeft(p) === 0 ? " — used up" : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-2">
                          📦 {packageLabel(chosen, held)}
                        </span>
                      )}
                      {isIn && (
                        <p className="mt-1 text-[11px] text-ink-3">
                          {k.key === "walk" && service === "boarding"
                            ? "No walk will be used — a walk package covers daycare walks only. This stay's walks bill per walk on the reservation."
                            : willUse
                              ? `Signing out now spends one ${k.key === "walk" ? "walk" : "day"} from this package.`
                              : k.key === "walk"
                                ? "No walk will be used — this visit has no walk booked."
                                : service !== "daycare"
                                  ? `No package day will be used — packages only cover daycare, and this is a ${serviceMeta?.label.toLowerCase()} visit.`
                                  : "No package day will be used — under 4 hours bills as a half day."}
                        </p>
                      )}
                    </div>
                  );
                })}

                <div className="mt-3">
                  <button
                    onClick={() => submit(dog, isIn ? "pick_up" : "drop_off")}
                    disabled={busyDogId === dog.id}
                    className={`rounded-xl px-4 py-2 text-sm font-medium text-white shadow-card transition disabled:opacity-60 ${
                      isIn ? "bg-slate-700 hover:bg-slate-800" : "bg-accent-500 hover:bg-accent-600"
                    }`}
                  >
                    {busyDogId === dog.id
                      ? "Saving…"
                      : isIn
                        ? `🏠 Sign ${dog.dog_name} out`
                        : `🚗 Sign ${dog.dog_name} in`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
