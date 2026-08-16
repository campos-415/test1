"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MeetGreetCard from "@/components/MeetGreetCard";
import { getSupabase } from "@/lib/supabase";
import { formatPhoneInput } from "@/lib/phone";
import { bathSizeForWeight, estimatePrice } from "@/lib/pricing";
import { prettyDateKey, todayKey } from "@/lib/dates";
import {
  daysLeft,
  eligiblePackagesFor,
  findPackageFor,
  packageBillingPickUp,
  packageKind,
  packagesBoughtOn,
  preferredPackageId,
} from "@/lib/dogs";
import { OpenVisit, loadPhoneContext, packageApplies, performSignIn, walkPackageApplies } from "@/lib/signin";
import { Balance, computeBalance, loadPayments, unpaidCharges } from "@/lib/billing";
import { prettyDateKey as prettyDay } from "@/lib/dates";
import {
  ADDONS,
  AddonKey,
  BathSize,
  Boarding,
  BOARDING_ADDONS,
  Dog,
  Package,
  PICKUP_WINDOWS,
  SERVICE_TYPES,
  ServiceType,
  SignAction,
  SignInRecord,
} from "@/types";
import { useSettings } from "@/components/SettingsProvider";
import SquarePayButton from "@/components/SquarePayButton";
import TerminalPayButton from "@/components/TerminalPayButton";
import Image from "next/image";

interface ConfirmedDog {
  dogName: string;
  daysLeft: number | null;
  priceDue: number | null;
  /** The visit was already closed, so nothing was written for this dog. */
  alreadyClosed: boolean;
}

export default function KioskForm() {
  const { settings } = useSettings();
  const business = settings.business;
  const [action, setAction] = useState<SignAction>("drop_off");
  // Whether anybody has actually said which of the two this is.
  //
  // `action` has always defaulted to drop_off, and the button rendered as
  // chosen — so the strongest thing on the screen was a decision nobody made.
  // Somebody collecting their dog would go straight to the keypad and sign a
  // second visit in. A separate flag rather than making `action` nullable:
  // it is read in three dozen places, none of which need a third state.
  const [actionChosen, setActionChosen] = useState(false);
  const [phone, setPhone] = useState("");
  const [dropOffBy, setDropOffBy] = useState("");
  const [service, setService] = useState<ServiceType>("daycare");
  // Add-ons are picked per dog, not shared across the whole sign-in — a
  // family dropping off two dogs together might only want a walk for one
  // of them. Keyed by client id.
  const [addonsByDog, setAddonsByDog] = useState<Record<string, AddonKey[]>>({});
  // Which pick-up window the parent picked for a dog getting a bath, keyed
  // by client id. Only meaningful while "bath" is among that dog's add-ons.
  const [pickupWindowByDog, setPickupWindowByDog] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedDog[] | null>(null);
  const [error, setError] = useState("");

  // All packages on file for the entered phone number — a dog-specific
  // package (dog_name set) takes priority; a package with no dog_name is
  // treated as shared across every dog on that number.
  const [packages, setPackages] = useState<Package[]>([]);
  const [pkgLoading, setPkgLoading] = useState(false);

  // Advance boarding reservations on file for the entered phone number —
  // a boarding drop-off is only allowed for a dog with a reservation
  // covering today (see activeBoardingFor below).
  const [boardings, setBoardings] = useState<Boarding[]>([]);

  // All dogs (clients) on file for the entered phone number.
  const [matches, setMatches] = useState<Dog[]>([]);
  // Which of those dogs are checking in for this visit — supports more
  // than one at once (e.g. two dogs from the same family together).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dogsLoading, setDogsLoading] = useState(false);
  const [dogsChecked, setDogsChecked] = useState(false);

  // dog_id -> their currently-open visit (a drop-off with no pick-up
  // after it yet), whenever it started — not limited to today, since a
  // boarding stay can span several days. Drives the "signed in" badge,
  // locks pick-up to the same service the dog was dropped off under, and
  // supplies the drop-off time + add-ons + bath size for pricing.
  const [openVisits, setOpenVisits] = useState<Map<string, OpenVisit>>(new Map());

  // Which selected dog's price breakdown is expanded, if any.
  const [breakdownOpenFor, setBreakdownOpenFor] = useState<string | null>(null);

  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dogs whose add-ons have already been pre-filled from their boarding
  // reservation. Tracked so the prefill happens once per selection and
  // never overwrites a change the parent made afterwards.
  const seededFromBoarding = useRef<Set<string>>(new Set());

  // dog_id -> bath size, seeded from a boarding reservation that already
  // booked one. A walk-in bath has no size here — staff assign it (and its
  // price) on /records.
  const [bathSizeByDog, setBathSizeByDog] = useState<Record<string, BathSize>>({});

  // This number's sign-in history, used to tell whether a package sale was
  // already billed to an earlier visit today.
  const [history, setHistory] = useState<Partial<SignInRecord>[]>([]);

  // What the household still owes from before today, so it can be settled at
  // the desk instead of quietly accumulating.
  const [balance, setBalance] = useState<Balance | null>(null);

  const selectedDogs: Dog[] = matches.filter((m) => m.id && selectedIds.includes(m.id));

  // Every package on this number that could cover the dog. A visit only
  // ever consumes a day from one of them.
  function eligiblePackages(dog: Dog): Package[] {
    return eligiblePackagesFor(packages, phone.trim(), dog.dog_name);
  }

  // The package this dog's visit draws from. The kiosk always takes the
  // default — choosing between a household's packages is a staff call, made
  // on the front-desk panel (components/StaffCheckIn.tsx).
  function packageFor(dog: Dog): Package | null {
    return findPackageFor(
      packages,
      phone.trim(),
      dog.dog_name,
      "daycare",
      preferredPackageId(dog, "daycare")
    );
  }

  // A package bought today is money owed on today's visit. One bought
  // earlier isn't — its days are already paid for.
  function soldToday(dog: Dog): { id?: string; days: number; price: number; unit: string }[] {
    const pricedPickUps = history.filter((h) => h.action === "pick_up" && h.price != null);
    return packagesBoughtOn(packages, phone.trim(), dog.dog_name, todayKey())
      // The pick-up about to be written hasn't happened yet, so a sale that
      // some earlier pick-up already claimed isn't owed again on this visit.
      .filter((p) => packageBillingPickUp(p, pricedPickUps) === null)
      .map((p) => ({
      id: p.id,
      days: p.total_days,
      price: p.price ?? 0,
      unit: packageKind(p) === "walk" ? "walks" : "days",
    }));
  }

  // The walk package this dog's walk add-on would draw from.
  function walkPackageFor(dog: Dog): Package | null {
    return findPackageFor(
      packages,
      phone.trim(),
      dog.dog_name,
      "walk",
      preferredPackageId(dog, "walk")
    );
  }

  // A boarding reservation for this dog that covers today — staff add
  // these in advance on /boardings. A boarding drop-off with no such
  // reservation is blocked (see handleSubmit) rather than silently
  // creating an unplanned stay.
  function activeBoardingFor(dog: Dog): Boarding | null {
    const today = todayKey();
    const forDog = boardings.filter(
      (b) => b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase()
    );
    return forDog.find((b) => b.start_date <= today && b.end_date >= today) ?? null;
  }

  // The soonest reservation still ahead of this dog — shown for
  // information only when there's no stay running today, so a parent
  // checking in for daycare still sees their upcoming boarding dates.
  function upcomingBoardingFor(dog: Dog): Boarding | null {
    const today = todayKey();
    return (
      boardings
        .filter(
          (b) =>
            b.dog_name.trim().toLowerCase() === dog.dog_name.trim().toLowerCase() &&
            b.start_date > today
        )
        .sort((a, b) => a.start_date.localeCompare(b.start_date))[0] ?? null
    );
  }

  // The reservation's add-ons, narrowed to the ones the kiosk actually
  // offers — a boarding reservation can also carry "medication", which
  // isn't a kiosk add-on and is handled by staff, not chosen at the door.
  function kioskAddonsFromBoarding(b: Boarding): AddonKey[] {
    const offered = ADDONS.map((a) => a.key);
    return ((b.addons ?? []) as string[]).filter((a): a is AddonKey =>
      offered.includes(a as AddonKey)
    );
  }

  // The service type that actually applies for this dog's current
  // action. At pick-up it's locked to whatever they were dropped off
  // under. At drop-off, a dog whose reservation covers today is always
  // boarding — the stay is already booked, so it can't be signed in as a
  // daycare visit — otherwise it's whatever the selector says. Decided
  // per dog, so one dog boarding doesn't force its housemate to.
  function effectiveService(dog: Dog): ServiceType {
    if (action === "pick_up" && dog.id) {
      const open = openVisits.get(dog.id);
      if (open) return open.serviceType;
    }
    if (action === "drop_off" && activeBoardingFor(dog)) return "boarding";
    // A dog on file that has never passed a meet and greet cannot do a normal
    // day yet. Approving the enrollment is what created the profile; the
    // assessment is what decides whether the dog joins a playgroup.
    if (action === "drop_off" && needsMeetGreet(dog)) return "meet_greet";
    return service;
  }

  // Has this dog ever passed an assessment?
  function needsMeetGreet(dog: Dog): boolean {
    if (!dog.id) return false;
    return !history.some((h) => h.dog_id === dog.id && h.meet_greet_result === "pass");
  }

  // Whether a package covers this dog's visit right now — full daycare days
  // only, so it depends on how long the dog has actually been here.
  function packageAppliesNow(dog: Dog, open: OpenVisit | undefined, pkg: Package | null, now: Date): boolean {
    return packageApplies(effectiveService(dog), open, pkg, now);
  }

  function walkAppliesNow(dog: Dog, open: OpenVisit | undefined): boolean {
    return walkPackageApplies(open, walkPackageFor(dog));
  }

  useEffect(() => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      setPackages([]);
      setMatches([]);
      setSelectedIds([]);
      setOpenVisits(new Map());
      setHistory([]);
      setBalance(null);
      setBoardings([]);
      setDogsChecked(false);
      return;
    }
    lookupTimer.current = setTimeout(async () => {
      setPkgLoading(true);
      setDogsLoading(true);
      setDogsChecked(false);
      try {
        // Same lookup the staff front-desk panel runs — see lib/signin.ts.
        const ctx = await loadPhoneContext(phone);
        setPackages(ctx.packages);
        setBoardings(ctx.boardings);
        setOpenVisits(ctx.openVisits);
        setHistory(ctx.history);
        // Non-fatal: an unreachable payments table shouldn't stop a check-in.
        try {
          const pays = await loadPayments(phone.trim());
          setBalance(computeBalance(ctx.history as SignInRecord[], ctx.packages, pays));
        } catch (e) {
          console.error("Loading balance failed:", e);
          setBalance(null);
        }
        const found = ctx.dogs;
        setMatches(found);

        // A single dog on file auto-selects itself; with more than one,
        // nothing is pre-selected — the person picks who's checking in.
        if (found.length === 1) {
          setSelectedIds(found[0].id ? [found[0].id] : []);
          setDropOffBy(found[0].drop_off_by ?? "");
        } else {
          setSelectedIds([]);
          setDropOffBy("");
        }
      } catch (e) {
        console.error("Lookup failed:", e);
      } finally {
        setPkgLoading(false);
        setDogsLoading(false);
        setDogsChecked(true);
      }
    }, 500);
  }, [phone]);

  // Pre-fill each selected dog's add-ons from its boarding reservation —
  // staff already agreed these with the client when the stay was booked,
  // so the parent shouldn't have to re-pick them at the door. Runs once
  // per dog per selection; toggling any chip afterwards sticks, and
  // deselecting the dog lets it seed fresh next time.
  useEffect(() => {
    if (action !== "drop_off") return;
    for (const dog of selectedDogs) {
      if (!dog.id || seededFromBoarding.current.has(dog.id)) continue;
      const reservation = activeBoardingFor(dog);
      if (!reservation) continue;
      seededFromBoarding.current.add(dog.id);
      const preset = kioskAddonsFromBoarding(reservation);
      if (preset.length) {
        setAddonsByDog((prev) => ({ ...prev, [dog.id as string]: preset }));
      }
      // The stay also booked a bath size, so carry it through — otherwise
      // the bath stays unpriced until staff retype the size on /records.
      if (preset.includes("bath") && reservation.bath_size) {
        setBathSizeByDog((prev) => ({ ...prev, [dog.id as string]: reservation.bath_size! }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, boardings, action]);

  // A dog that's been deselected should seed again if it's picked back up.
  useEffect(() => {
    for (const id of Array.from(seededFromBoarding.current)) {
      if (!selectedIds.includes(id)) seededFromBoarding.current.delete(id);
    }
  }, [selectedIds]);

  function selectAction(next: SignAction) {
    setAction(next);
    setActionChosen(true);
    if (next === "pick_up") {
      setAddonsByDog({});
      seededFromBoarding.current.clear();
    }
  }

  function toggleAddon(dogId: string, key: AddonKey) {
    setAddonsByDog((prev) => {
      const current = prev[dogId] ?? [];
      const next = current.includes(key) ? current.filter((a) => a !== key) : [...current, key];
      // Dropping the bath drops the pick-up window with it — the window
      // only exists to tell grooming when the dog is due back out front.
      if (key === "bath" && !next.includes("bath")) {
        setPickupWindowByDog((windows) => {
          const { [dogId]: _removed, ...rest } = windows;
          return rest;
        });
      }
      return { ...prev, [dogId]: next };
    });
  }

  function toggleDog(id: string | undefined) {
    if (!id) return;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function resetForm() {
    setPhone("");
    setDropOffBy("");
    setService("daycare");
    setAddonsByDog({});
    setPickupWindowByDog({});
    seededFromBoarding.current.clear();
    setAction("drop_off");
    // The next person at the kiosk must choose for themselves. Without this
    // they would inherit whichever way the last client went.
    setActionChosen(false);
    setPackages([]);
    setMatches([]);
    setSelectedIds([]);
    setOpenVisits(new Map());
    setHistory([]);
    setBalance(null);
    setBoardings([]);
    setDogsChecked(false);
    setBreakdownOpenFor(null);
  }

  // What was owed from before, captured at the moment of signing out.
  // Afterwards the balance includes today's charge as well, so re-reading it
  // and adding today's total again would count the visit twice.
  const [priorDueAtSubmit, setPriorDueAtSubmit] = useState(0);

  async function handleSubmit() {
    setError("");
    if (selectedDogs.length === 0) {
      setError(
        matches.length > 1
          ? "Select which dog (or dogs) are checking in."
          : "Look up a phone number with an approved profile before signing in."
      );
      return;
    }
    if (action === "drop_off") {
      const alreadyIn = selectedDogs.filter((d) => d.id && openVisits.has(d.id));
      if (alreadyIn.length) {
        setError(
          `${alreadyIn.map((d) => d.dog_name).join(", ")} ${
            alreadyIn.length > 1 ? "are" : "is"
          } already signed in — pick them up before dropping off again.`
        );
        return;
      }
      // Dogs with a reservation are boarding regardless of the selector,
      // so only the others can trip this — picking Boarding for a dog
      // with nothing booked is the case being blocked.
      if (service === "boarding") {
        const noReservation = selectedDogs.filter((d) => !activeBoardingFor(d));
        if (noReservation.length) {
          setError(
            `No reservation found for ${noReservation
              .map((d) => d.dog_name)
              .join(", ")}. Pick a different service, or ask staff to add a boarding reservation first.`
          );
          return;
        }
      }
    }
    setSubmitting(true);

    try {
      const results: ConfirmedDog[] = [];
      const now = new Date();
      // Same exclusion as the figure on screen. This is the number the
      // receipt says was owed beforehand, so if it counted a package sale
      // that today's total is also folding in, the receipt would disagree
      // with itself.
      setPriorDueAtSubmit(
        action === "pick_up" && balance
          ? unpaidCharges(balance)
              .filter((c) => !foldedPackageKeys.has(c.key))
              .reduce((sum, c) => sum + c.remaining, 0)
          : 0
      );

      // One dog at a time so a package-day deduction failure for one dog
      // doesn't affect the others' rows. The write itself lives in
      // lib/signin.ts, shared with the staff front-desk panel.
      for (const dog of selectedDogs) {
        const dogAddons = dog.id ? (addonsByDog[dog.id] ?? []) : [];

        const result = await performSignIn({
          dog,
          action,
          serviceType: effectiveService(dog),
          phone,
          byName: dropOffBy,
          addons: dogAddons,
          pickupWindow:
            dogAddons.includes("bath") && dog.id ? (pickupWindowByDog[dog.id] ?? null) : null,
          // Falls back to the size the dog's weight puts it in.
          //
          // Nothing at the kiosk ever asked for a size — it was only filled
          // in from a boarding reservation that already had one — so a bath
          // added here carried none, and a visit with no size is charged
          // nothing for the bath. Baths booked at the lobby iPad were free.
          bathSize: dog.id
            ? (bathSizeByDog[dog.id] ?? bathSizeForWeight(dog.weight_lb))
            : null,
          openVisit: dog.id ? (openVisits.get(dog.id) ?? null) : null,
          pkg: packageFor(dog),
          packagesSold: soldToday(dog),
          walkPkg: walkPackageFor(dog),
          now,
        });
        results.push({
          dogName: result.dogName,
          daysLeft: result.daysLeft,
          priceDue: result.priceDue,
          alreadyClosed: !!result.alreadyClosed,
        });
      }

      setConfirmed(results);
      setTimeout(() => {
        setConfirmed(null);
        resetForm();
      }, 2600);
    } catch (e) {
      console.error("Sign-in save failed:", e);
      setError("Couldn't save — check the connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // What this pick-up came to across every dog on the number.
  //
  // An already-closed visit contributes nothing: its charge was written on an
  // earlier sign-out, so it is already inside priorDueAtSubmit. Counting it
  // here as well is how the amount handed to Square would double.
  const confirmedTotal =
    (confirmed ?? []).reduce((sum, c) => sum + (c.alreadyClosed ? 0 : (c.priceDue ?? 0)), 0) +
    priorDueAtSubmit;

  // Every dog refused means nothing happened, so a tick would be a lie.
  const nothingWritten = !!confirmed && confirmed.length > 0 && confirmed.every((c) => c.alreadyClosed);

  if (confirmed) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full text-3xl shadow-card ${
            nothingWritten ? "bg-amber-500 text-white" : "bg-accent-500 text-accent-ink"
          }`}
        >
          {nothingWritten ? "!" : "✓"}
        </div>
        <div className="space-y-1.5">
          {confirmed.map((c) => (
            <p key={c.dogName} className="text-lg font-medium text-ink">
              {c.alreadyClosed ? (
                <>
                  {c.dogName} was already signed out
                  <span className="ml-2 text-sm font-normal text-ink-3">
                    nothing was charged again
                  </span>
                </>
              ) : (
                <>{c.dogName} {action === "drop_off" ? "dropped off" : "picked up"}</>
              )}
              {c.daysLeft !== null && (
                <span className="ml-2 text-sm font-medium text-accent-600">
                  {c.daysLeft > 0 ? `· ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left` : "· last day on package"}
                </span>
              )}
              {/* An already-closed visit's price is history, not a new charge —
                  it is already inside the balance shown below. */}
              {c.priceDue !== null && !c.alreadyClosed && (
                <span className="ml-2 text-sm font-medium text-emerald-600">
                  · ${c.priceDue.toFixed(2)} due
                </span>
              )}
            </p>
          ))}
        </div>

        {/* Pay on the way out. Only on a pick-up, and only when something is
            actually owed — a visit covered by a package owes nothing and
            should not be asked for money. */}
        {action === "pick_up" && confirmedTotal > 0 && (
          <div className="mt-2 flex flex-col items-center gap-2">
            <SquarePayButton
              amount={confirmedTotal}
              note={confirmed
                .filter((c) => c.priceDue)
                .map((c) => `${c.dogName}: $${c.priceDue!.toFixed(2)}`)
                .join(" | ")}
              phone={phone.trim()}
              dogNames={confirmed.filter((c) => c.priceDue).map((c) => c.dogName)}
              returnTo="/kiosk"
              label="Pay now"
            />
            {priorDueAtSubmit > 0 && (
              <p className="text-xs text-ink-3">
                Includes ${priorDueAtSubmit.toFixed(2)} still owed from before.
              </p>
            )}
            <p className="text-xs text-ink-3">Or settle at the front desk.</p>
          </div>
        )}
      </div>
    );
  }

  const digits = phone.replace(/\D/g, "");
  const phoneEntered = digits.length >= 7;
  // Every dog being dropped off is still waiting for its assessment. A mixed
  // household keeps the full choice — one dog's first visit should not stop
  // its housemate coming in for daycare.
  // Asks what the visit will ACTUALLY be recorded as, not merely whether the
  // dog is owed an assessment. A dog with a boarding reservation is signed in
  // as boarding even on its first visit — effectiveService puts the
  // reservation first — so testing needsMeetGreet alone would hide the
  // service picker and then file something else.
  const allNeedMeetGreet =
    action === "drop_off" &&
    selectedDogs.length > 0 &&
    selectedDogs.every((d) => effectiveService(d) === "meet_greet");

  // Birthdays today, compared on month and day so it fires every year.
  const birthdayDogs = selectedDogs.filter((d) => {
    const born = (d.birthdate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(born)) return false;
    const now = new Date();
    return (
      born.slice(5, 7) === String(now.getMonth() + 1).padStart(2, "0") &&
      born.slice(8, 10) === String(now.getDate()).padStart(2, "0")
    );
  });

  const showNoProfile = phoneEntered && dogsChecked && !dogsLoading && matches.length === 0;
  const showDogPicker = matches.length > 1;
  const now = new Date();

  // What this dog owes for the visit it is being collected from. Null on a
  // drop-off, or when nothing is open.
  //
  // `additional` is the second-dog rate. The kiosk is the one place that can
  // see a household as a household — these dogs were looked up on one phone
  // number and are being collected together — so position in that selection
  // is what decides it. A dog covered by a package is not counted as one of
  // the paying dogs, or the first dog on a package would silently push the
  // second onto the discounted rate and the household would pay less than it
  // should for both.
  function pickUpEstimate(dog: Dog, additional = false) {
    const open = dog.id ? openVisits.get(dog.id) : undefined;
    if (action !== "pick_up" || !open) return null;
    const pkg = packageFor(dog);
    return estimatePrice(
      effectiveService(dog),
      open.dropOffTime,
      now,
      open.addons,
      packageAppliesNow(dog, open, pkg, now),
      open.bathSize,
      true,
      soldToday(dog),
      walkAppliesNow(dog, open),
      additional
    );
  }

  /** Which of the selected dogs are paying a base rate, in order. */
  function payingDogIds(): string[] {
    return selectedDogs
      .filter((dog) => {
        const open = dog.id ? openVisits.get(dog.id) : undefined;
        if (!open) return false;
        return !packageAppliesNow(dog, open, packageFor(dog), now);
      })
      .map((dog) => dog.id ?? dog.dog_name);
  }

  // Today's charges, one line per dog being collected. The first paying dog
  // of the household pays the full rate; the rest take the second-dog rate.
  const paying = payingDogIds();
  const dueTodayItems = selectedDogs
    .map((dog) => {
      const id = dog.id ?? dog.dog_name;
      const est = pickUpEstimate(dog, paying.indexOf(id) > 0);
      return est && est.amount > 0
        ? { key: id, dogName: dog.dog_name, label: est.label, amount: est.amount }
        : null;
    })
    .filter((x): x is { key: string; dogName: string; label: string; amount: number } => !!x);

  // Still owed from before. Today's visit is not in here — a visit is only
  // priced when the dog is signed out — so the two cannot double up on the
  // visit itself.
  //
  // A package sale is different, and this is where it went wrong. A sale is a
  // charge from the moment it is made, so it is already sitting on the
  // balance; computeBalance only drops it once a priced pick-up has absorbed
  // it. Today's estimate asks the same question, gets the same answer, and
  // folds the sale in as well — so a client who bought a package and is now
  // collecting their dog was asked for it twice, once as an outstanding
  // charge and once as part of today.
  //
  // Whatever the estimate is about to fold in comes out of the balance side.
  // The estimate is the right place for it: it is what the pick-up will
  // actually be saved with.
  const foldedPackageKeys = new Set(
    selectedDogs.flatMap((dog) =>
      soldToday(dog).map((sold) => `pkg-${sold.id}`)
    )
  );
  const previousDue =
    action === "pick_up" && balance
      ? unpaidCharges(balance).filter((c) => !foldedPackageKeys.has(c.key))
      : [];

  const amountDue =
    dueTodayItems.reduce((sum, i) => sum + i.amount, 0) +
    previousDue.reduce((sum, c) => sum + c.remaining, 0);

  // Paying navigates away to the Square app, which would discard an
  // un-submitted sign-out. So the dog is signed out first, and only a
  // successful sign-out lets the payment proceed.
  async function signOutBeforePaying(): Promise<boolean> {
    if (confirmed) return true; // already signed out
    try {
      await handleSubmit();
      return true;
    } catch (e) {
      console.error("Could not sign out before payment:", e);
      return false;
    }
  }

  const hasDuplicateDropOff =
    action === "drop_off" && selectedDogs.some((d) => d.id && openVisits.has(d.id));

  // The mirror of hasDuplicateDropOff: a dog that is not signed in cannot be
  // signed out. Blocking it here is what stops a second sign-out — and with it
  // a second charge for the same visit — rather than letting the client press
  // the button and find out afterwards. lib/signin.ts refuses it as well; this
  // is the half that can explain itself.
  const alreadyOutDogs =
    action === "pick_up" ? selectedDogs.filter((d) => !d.id || !openVisits.has(d.id)) : [];
  const hasAlreadySignedOut = alreadyOutDogs.length > 0;
  // Dogs whose stay covers today — they sign in as boarding no matter
  // what the service selector says (see effectiveService). The rest fall
  // to the selector, so a reserved dog and a daycare dog can check in
  // together on one sign-in.
  // Dogs already in the building are excluded: their drop-off is blocked
  // anyway, and mentioning the reservation again once the dog has arrived
  // reads as though something is still outstanding.
  const reservedDogs =
    action === "drop_off"
      ? selectedDogs.filter(
          (d) => !!activeBoardingFor(d) && !(d.id && openVisits.has(d.id))
        )
      : [];
  const unreservedDogs =
    action === "drop_off" ? selectedDogs.filter((d) => !activeBoardingFor(d)) : [];
  // Only a dog with no reservation can be missing one — asking to board
  // it explicitly via the selector is what's blocked here.
  const hasMissingBoardingReservation =
    action === "drop_off" &&
    service === "boarding" &&
    unreservedDogs.some((d) => !d.id || !openVisits.has(d.id));

  return (
    <div className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-col items-center text-center">
        {/* Branding comes from /settings, falling back to the bundled logo
            so a fresh install still looks finished. */}
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex items-center justify-center rounded-2xl text-xl text-white shadow-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={business.logoData || "/logo.svg"}
              alt={business.name}
              className="h-[100px] w-[100px] object-contain"
            />
          </span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {business.name}
        </h1>
        <p className="mt-1 text-sm text-ink-3">{business.tagline}</p>
      </div>

      <div className="rounded-3xl bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-6 grid grid-cols-2 gap-3">
          <button
            onClick={() => selectAction("drop_off")}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              actionChosen && action === "drop_off"
                ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                : "border-line bg-surface text-ink-2 hover:border-line"
            }`}>
            🚗 Drop off
          </button>
          <button
            onClick={() => selectAction("pick_up")}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
              actionChosen && action === "pick_up"
                ? "border-accent-500 bg-accent-500 text-accent-ink shadow-card"
                : "border-line bg-surface text-ink-2 hover:border-line"
            }`}>
            🏠 Pick up
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-3">
            Phone number
          </label>
          <input
            value={phone}
            onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
            placeholder="(123) 456-7890"
            inputMode="numeric"
            autoFocus
            disabled={!actionChosen}
            className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-base text-ink outline-none transition focus:border-accent-500 focus:bg-surface focus:ring-2 focus:ring-accent-100 disabled:cursor-not-allowed disabled:opacity-50"
          />

          {!actionChosen && (
            <p className="mt-2 text-xs text-ink-3">
              Choose drop off or pick up to start.
            </p>
          )}

          {phoneEntered && dogsLoading && (
            <p className="mt-2 text-xs text-ink-3">Looking you up…</p>
          )}

          {showNoProfile && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <p className="font-medium">No profile found for this number.</p>
              <p className="mt-1 text-xs text-amber-700">
                First time here? Fill in the enrollment form. We&apos;ll review it and confirm by
                email — after that, your phone number is all you need to check in.
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Already sent one in? It may still be waiting for approval — please check with the
                front desk.
              </p>
              <Link
                href="/signup"
                className="mt-2 inline-block rounded-xl bg-amber-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-700">
                Start enrollment
              </Link>
            </div>
          )}

          {showDogPicker && (
            <div className="mt-3 rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3">
              <p className="text-sm font-medium text-accent-800">
                Which dog (or dogs)?
              </p>
              <p className="mt-0.5 text-xs text-accent-600">
                This number has {matches.length} dogs on file — tap all that are
                checking in together.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {matches.map((m) => {
                  const selected = !!m.id && selectedIds.includes(m.id);
                  const isIn = !!m.id && openVisits.has(m.id);
                  const pkg = packageFor(m);
                  return (
                    <button
                      key={m.id}
                      onClick={() => toggleDog(m.id)}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-accent-500 bg-accent-500 text-accent-ink"
                          : "border-accent-200 bg-surface text-accent-700 hover:border-accent-400"
                      }`}>
                      {selected ? "✓ " : "🐕 "}
                      {m.dog_name}
                      {isIn && !selected ? " · 🟢 signed in" : ""}
                      {pkg && !selected ? " 📦" : ""}
                    </button>
                  );
                })}
              </div>
              <Link
                href="/signup"
                className="mt-2 inline-block text-xs font-medium text-accent-600 hover:text-accent-800">
                Add another dog to this number
              </Link>
            </div>
          )}

          {/* Anything owed on this number, oldest charge first. Shown for the
              household rather than per dog, since that's how it's paid — and
              it includes today's charges, not just older ones. */}



          {selectedDogs.length > 0 && (
            <div className="mt-3 space-y-2">
              {selectedDogs.map((dog) => {
                const pkg = packageFor(dog);
                const dogPackages = eligiblePackages(dog);
                const open = dog.id ? openVisits.get(dog.id) : undefined;
                const isIn = !!open;
                const effService = effectiveService(dog);
                const serviceLabel = SERVICE_TYPES.find(
                  (s) => s.key === effService,
                );
                const usingPackage =
                  action === "pick_up"
                    ? packageAppliesNow(dog, open, pkg, now)
                    : false;
                // Same second-dog reckoning as the total below it. Left out,
                // this card would show one dog the full rate while the total
                // charged the discounted one, and the two would disagree in
                // front of the client.
                const priceEstimate = pickUpEstimate(
                  dog,
                  paying.indexOf(dog.id ?? dog.dog_name) > 0
                );
                const showBreakdown = breakdownOpenFor === dog.id;
                const reservation = activeBoardingFor(dog);
                // Only today's stay drives the add-on prefill; an upcoming
                // one is shown purely so the parent can see it's booked.
                const upcoming = reservation ? null : upcomingBoardingFor(dog);
                // A dog that is already signed in has arrived, so the booking
                // has served its purpose — repeating "reservation on file" on
                // every later lookup reads as though something is still
                // outstanding. The badge beside the name says where it is.
                const shownReservation = isIn ? null : (reservation ?? upcoming);
                return (
                  <div
                    key={dog.id}
                    className="rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-accent-800">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      {dog.photo_data ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dog.photo_data}
                          alt={`${dog.dog_name}'s photo`}
                          className="h-14 w-14 rounded-full object-cover ring-2 ring-white"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface text-xl ring-2 ring-white">
                          🐕
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {dog.dog_name} · {dog.last_name}
                      {isIn && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          🟢 Signed in
                        </span>
                      )}
                      {action === "pick_up" && open && (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                          {serviceLabel?.icon} {serviceLabel?.label}
                        </span>
                      )}
                      {action === "drop_off" && !isIn && reservation && (
                        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-accent-700">
                          🛏️ Boarding · reserved
                        </span>
                      )}
                    </p>
                    {/* Packages are hidden on a first visit.
                        A meet & greet does not spend a package day and nobody
                        has bought one yet, so "No package on file" reads as a
                        problem to solve at the very moment the household is
                        being told this visit is free of all that. Once the
                        dog is coming for daycare the line comes back. */}
                    {effService === "meet_greet" ? null : pkgLoading ? (
                      <p className="mt-1 text-xs text-accent-600">
                        Checking for a package…
                      </p>
                    ) : pkg ? (
                      <>
                        {/* The package this visit will actually draw from —
                            the one pinned on the dog's profile when there is
                            one, marked so it's clear the choice was
                            deliberate rather than arbitrary. Which package a
                            visit spends stays a staff decision; the kiosk
                            only reports it. */}
                        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-accent-700">
                          {preferredPackageId(dog, "daycare") === pkg.id ? "📌" : "📦"}{" "}
                          {daysLeft(pkg)} of {pkg.total_days} days left
                          {pkg.dog_name ? "" : " (shared)"}
                          {action === "pick_up" &&
                            open &&
                            !usingPackage &&
                            " — today's visit was 4hrs or less, half day rate applies"}
                        </span>
                        {(() => {
                          const wp = walkPackageFor(dog);
                          if (!wp) return null;
                          return (
                            <span className="ml-1.5 mt-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-emerald-700">
                              {preferredPackageId(dog, "walk") === wp.id ? "📌" : "🚶"}{" "}
                              {daysLeft(wp)} of {wp.total_days} walks left
                              {wp.dog_name ? "" : " (shared)"}
                            </span>
                          );
                        })()}
                        {dogPackages.length > 1 && (
                          <p className="mt-1 text-[11px] text-accent-500">
                            {dogPackages.length} daycare packages on file — this visit uses the
                            {preferredPackageId(dog, "daycare") === pkg.id
                              ? " one set as default."
                              : " one above."}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-accent-600">
                        No package on file for {dog.dog_name}
                      </p>
                        )}
                    {shownReservation && (
                      <div className="mt-2 rounded-xl bg-surface px-3 py-2 text-xs text-ink-2">
                        <p className="font-medium text-accent-800">
                          🛏️ {upcoming ? "Upcoming boarding reservation" : "Boarding reservation on file"}
                        </p>
                        <p className="mt-0.5">
                          {prettyDateKey(shownReservation.start_date)} →{" "}
                          {prettyDateKey(shownReservation.end_date)}
                          <span className="text-ink-3">
                            {" "}
                            · pick up {prettyDateKey(shownReservation.end_date)}
                          </span>
                        </p>
                        {(shownReservation.addons ?? []).length > 0 && (
                          <p className="mt-0.5">
                            Add-ons booked:{" "}
                            {(shownReservation.addons ?? [])
                              .map((a) => {
                                const label = BOARDING_ADDONS.find((x) => x.key === a)?.label ?? a;
                                if (a === "walk" && shownReservation.walks_per_day) {
                                  return `${label} (${shownReservation.walks_per_day}/day)`;
                                }
                                if (a === "bath" && shownReservation.bath_size) {
                                  return `${label} (${shownReservation.bath_size})`;
                                }
                                return label;
                              })
                              .join(", ")}
                          </p>
                        )}
                        {/* {shownReservation.feeding_instructions && (
                          <p className="mt-0.5 text-ink-3">🍽️ {shownReservation.feeding_instructions}</p>
                        )} */}
                      </div>
                    )}
                    {/* A first visit gets the assessment, not the upsell.
                        Almost nobody books a bath for a meet & greet, and the
                        space is worth more to the person holding the lead —
                        and to whoever takes the dog through. */}
                    {action === "drop_off" && !isIn && effectiveService(dog) === "meet_greet" && (
                      <MeetGreetCard dog={dog} />
                    )}
                    {action === "drop_off" && !isIn && effectiveService(dog) !== "meet_greet" && (
                      <div className="mt-2">
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-accent-500">
                          Add-ons for {dog.dog_name} (optional)
                          {reservation && (
                            <span className="ml-1 font-normal normal-case tracking-normal text-ink-3">
                              — pre-filled from the reservation, tap to change
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {ADDONS.map((a) => {
                            const active = !!dog.id && (addonsByDog[dog.id] ?? []).includes(a.key);
                            return (
                              <button
                                key={a.key}
                                onClick={() => dog.id && toggleAddon(dog.id, a.key)}
                                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                  active
                                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                    : "border-line bg-surface text-ink-3 hover:border-line"
                                }`}>
                                {a.icon} {a.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* A bath takes most of the day, so grooming needs to
                            know when the dog is expected back out front. */}
                        {!!dog.id && (addonsByDog[dog.id] ?? []).includes("bath") && (
                          <div className="mt-2 rounded-xl bg-surface px-3 py-2">
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-accent-500">
                              🛁 What time will you pick {dog.dog_name} up?
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {PICKUP_WINDOWS.map((w) => {
                                const active = pickupWindowByDog[dog.id!] === w;
                                return (
                                  <button
                                    key={w}
                                    onClick={() =>
                                      setPickupWindowByDog((prev) => ({
                                        ...prev,
                                        [dog.id!]: active ? "" : w,
                                      }))
                                    }
                                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                      active
                                        ? "border-sky-500 bg-sky-50 text-sky-700"
                                        : "border-line bg-surface text-ink-3 hover:border-line"
                                    }`}>
                                    {w}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {priceEstimate && (
                      <div className="mt-1.5">
                        <button
                          onClick={() =>
                            setBreakdownOpenFor(
                              showBreakdown ? null : (dog.id ?? null),
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-200">
                          💵 ${priceEstimate.amount.toFixed(2)} due today:{" "}
                          {/* {priceEstimate.label} */}
                          <span className="text-emerald-500">🧾</span>
                        </button>
                        {showBreakdown && (
                          <ul className="mt-1.5 space-y-0.5 rounded-xl bg-surface px-3 py-2 text-xs text-ink-2">
                            {priceEstimate.breakdown.map((item, i) => (
                              <li
                                key={i}
                                className="flex justify-between gap-4">
                                <span>{item.label}</span>
                                <span className="font-medium">
                                  ${item.amount.toFixed(2)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    {action === "pick_up" &&
                      open?.addons.includes("bath") &&
                      !open.bathSize && (
                        <p className="mt-1.5 text-xs font-medium text-amber-700">
                          🛁 Bath requested — please ask one of the staff for
                          pricing information.
                        </p>
                      )}
                    {action === "pick_up" && !open && (
                      <p className="mt-1.5 text-xs text-accent-600">
                        {dog.dog_name} is not signed in yet — please select drop
                        off.
                      </p>
                    )}
                    {isIn && action === "drop_off" && (
                      <p className="mt-2 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                        {dog.dog_name} is already signed in — pick up first
                        before dropping off again.
                      </p>
                    )}
                    {!isIn &&
                      action === "drop_off" &&
                      service === "boarding" &&
                      !activeBoardingFor(dog) && (
                        <p className="mt-2 rounded-lg bg-rose-100 px-2.5 py-1.5 text-xs font-medium text-rose-700">
                          🛏️ No reservation found for {dog.dog_name} — ask
                          staff to add a boarding reservation before drop-off.
                        </p>
                      )}
                    </div>
                  </div>
                  </div>
                );
              })}
            </div>
          )}
          {action === "pick_up" && amountDue > 0 && (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              {/* Only what is NOT already on a dog card: anything still owed
                  from before. Today's charges stay on the dog they belong
                  to, so no figure is printed twice. */}
              {previousDue.length > 0 && (
                <ul className="mb-2 space-y-0.5 border-b border-emerald-200 pb-2">
                  {previousDue.map((c) => (
                    <li key={c.key} className="flex justify-between gap-4 text-xs text-emerald-800/80">
                      <span>
                        {c.label}
                        <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium">
                          {c.date === todayKey() ? "earlier today" : `from ${prettyDay(c.date)}`}
                        </span>
                      </span>
                      <span className="whitespace-nowrap font-medium">${c.remaining.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base font-semibold text-emerald-900">
                  Total due ${amountDue.toFixed(2)}
                </span>
                {/* One or the other, never both — each returns null unless
                    the configured mode is its own. Which one a business gets
                    is decided by its hardware, not its preference: a Reader
                    paired to a tablet can only be handed off to, and a
                    Terminal can only be driven remotely. */}
                <span className="ml-auto">
                  <SquarePayButton
                    amount={amountDue}
                    note={[
                      ...dueTodayItems.map((i) => `${i.dogName}: ${i.label}`),
                      ...previousDue.map((c) => `${c.label} (${c.date})`),
                    ].join(" | ")}
                    phone={phone.trim()}
                    dogNames={selectedDogs.map((d) => d.dog_name)}
                    returnTo="/kiosk"
                    label="Pay now"
                    beforePay={signOutBeforePaying}
                  />
                  <TerminalPayButton
                    amount={amountDue}
                    note={[
                      ...dueTodayItems.map((i) => `${i.dogName}: ${i.label}`),
                      ...previousDue.map((c) => `${c.label} (${c.date})`),
                    ].join(" | ")}
                    phone={phone.trim()}
                    dogNames={selectedDogs.map((d) => d.dog_name)}
                    // The visit being paid for. Square deduplicates on this,
                    // so a double tap is the same payment rather than a
                    // second one — see the note in the API route.
                    reference={`${phone.trim()}-${todayKey()}`}
                    beforePay={signOutBeforePaying}
                  />
                </span>
              </div>
              {/* What this line says depends on whether there is anything to
                  pay WITH.

                  Card payment is something a business switches on. With it
                  off there is no Pay now button beside this total, so
                  "paying signs the dog out first" describes a control that
                  is not on the screen — and a client reads it, looks for the
                  button, and asks the front desk where it is.

                  The second half is only an alternative when there is a
                  first half. On its own it is the whole instruction. */}
              <p className="mt-1.5 text-[11px] text-emerald-800">
                {!settings.square.enabled
                  ? "A staff member will take payment."
                  : hasAlreadySignedOut
                    ? "This settles what is still owed. Or settle with a staff member."
                    : `Paying signs ${
                        selectedDogs.length > 1 ? "them" : "the dog"
                      } out first. Or settle with a staff member.`}
              </p>
            </div>
          )}

          {matches.length === 1 && (
            <Link
              href="/signup"
              className="mt-2 inline-block text-xs font-medium text-ink-3 hover:text-ink-2">
              Add another dog to this number
            </Link>
          )}
        </div>

        {selectedDogs.length > 0 && (
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ink-3">
                {action === "drop_off" ? "Drop off by" : "Picked up by"}
              </label>
              <input
                value={dropOffBy}
                onChange={(e) => setDropOffBy(e.target.value)}
                placeholder="Parent/guardian"
                className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink outline-none transition focus:border-accent-500 focus:bg-surface focus:ring-2 focus:ring-accent-100"
              />
            </div>

            <div className="flex flex-col">
              {/* At pick-up, service is locked per-dog from their drop-off
                  (shown as badges above) — a dog signed in as daycare can
                  only be picked up as daycare, same for boarding. The
                  selector below only matters for drop-off, or as a manual
                  fallback for a dog with no open drop-off on file. */}
              {action === "drop_off" ? (
                <>
                  {/* Reserved dogs are already boarding, so this selector
                      only governs the dogs without a reservation — that's
                      what lets one dog board while another does daycare
                      in the same sign-in. */}
                  {reservedDogs.length > 0 && (
                    <p className="mb-2 rounded-lg bg-accent-50 px-2.5 py-1.5 text-xs text-accent-700">
                      🛏️ {reservedDogs.map((d) => d.dog_name).join(", ")}{" "}
                      {reservedDogs.length > 1 ? "are" : "is"} boarding today — set by the reservation.
                    </p>
                  )}
                  {unreservedDogs.length > 0 && (
                    <>
                      <label className="mb-1.5 block text-xs font-medium text-ink-3">
                        Service
                        {reservedDogs.length > 0 && (
                          <span className="ml-1 font-normal text-ink-3">
                            for {unreservedDogs.map((d) => d.dog_name).join(", ")}
                          </span>
                        )}
                      </label>
                      {birthdayDogs.length > 0 && (
                        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                          🎂 Happy birthday{" "}
                          <span className="font-semibold">
                            {birthdayDogs.map((d) => d.dog_name).join(" and ")}
                          </span>
                          ! Take 10% off your next package — just mention it at the desk.
                        </p>
                      )}
                      {allNeedMeetGreet && (
                        <p className="mb-3 rounded-xl bg-violet-50 px-3 py-2 text-xs leading-relaxed text-violet-900">
                          ✨ First visit — this is a meet &amp; greet. Once it has gone well,
                          {selectedDogs.length === 1 ? " your dog" : " your dogs"} can book daycare and
                          boarding.
                        </p>
                      )}
                      {/* No picker on a first visit. It was already narrowed
                          to the single meet & greet option, which is a choice
                          with one answer — and it rendered unselected, so it
                          read as a required question nobody had answered. The
                          note above says what the visit is; the sign-in
                          records it from the dog's own history either way. */}
                      <div className={`mb-4 flex flex-wrap gap-2 ${allNeedMeetGreet ? "hidden" : ""}`}>
                        {SERVICE_TYPES.map((s) => (
                          <button
                            key={s.key}
                            onClick={() => setService(s.key)}
                            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                              service === s.key
                                ? "border-accent-500 bg-accent-50 text-accent-700"
                                : "border-line bg-surface text-ink-3 hover:border-line"
                            }`}>
                            {s.icon} {s.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                hasAlreadySignedOut && (
                  <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                    {alreadyOutDogs.length === 1
                      ? `${alreadyOutDogs[0].dog_name} is not signed in, so there is nothing to sign out.`
                      : `${alreadyOutDogs.map((d) => d.dog_name).join(" and ")} are not signed in, so there is nothing to sign out.`}{" "}
                    If {alreadyOutDogs.length === 1 ? "they were" : "they were"} already collected
                    today, this is done — please see a staff member if something looks wrong.
                  </p>
                )
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-5 text-xs font-medium text-rose-500">{error}</p>
        )}

        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={
              submitting ||
              selectedDogs.length === 0 ||
              hasDuplicateDropOff ||
              hasAlreadySignedOut ||
              hasMissingBoardingReservation
            }
            className="rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting
              ? action === "drop_off"
                ? "Signing in…"
                : "Signing out…"
              : hasDuplicateDropOff
                ? "Already signed in"
                : hasAlreadySignedOut
                ? "Already signed out"
                : hasMissingBoardingReservation
                  ? "No reservation found"
                  : action === "drop_off"
                  ? selectedDogs.length > 1
                    ? `Sign in ${selectedDogs.length} dogs`
                    : "Sign in"
                  : selectedDogs.length > 1
                    ? `Sign out ${selectedDogs.length} dogs`
                    : "Sign out"}
          </button>
          <Link
            href="/signup"
            className="ml-auto text-xs font-medium text-ink-3 hover:text-ink-2">
            New client enrollment
          </Link>
        </div>
      </div>
    </div>
  );
}
