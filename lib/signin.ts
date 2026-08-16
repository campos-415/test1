// The one place a sign-in or sign-out is written. Both the lobby kiosk
// (components/KioskForm.tsx) and the staff front-desk panel
// (components/StaffCheckIn.tsx) go through here, so package deduction and
// pricing can't drift apart between them.

import { getSupabase } from "@/lib/supabase";
import { bathSizeForWeight, estimatePrice, isFullDayVisit } from "@/lib/pricing";
import { todayKey } from "@/lib/dates";
import {
  BathSize,
  Boarding,
  Dog,
  Package,
  ServiceType,
  SignAction,
  SignInRecord,
} from "@/types";
import { activeDogs } from "@/lib/retire";

// A drop-off with no pick-up after it yet. Not limited to today — a
// boarding stay's drop-off can be several days before its pick-up.
export interface OpenVisit {
  serviceType: ServiceType;
  dropOffTime: Date;
  addons: string[];
  bathSize: BathSize | null;
  // Staff said this visit must not spend a package day, overriding the
  // past-four-hours rule. Undefined means nobody decided.
  packageOptOut?: boolean;
}

export interface PhoneContext {
  dogs: Dog[];
  packages: Package[];
  boardings: Boarding[];
  openVisits: Map<string, OpenVisit>;
  // Raw history rows, needed to tell whether a package sale has already been
  // billed to an earlier pick-up today (see packageAlreadyBilled).
  history: Partial<SignInRecord>[];
}

// Everything both surfaces need about a phone number in one round trip.
export async function loadPhoneContext(phone: string): Promise<PhoneContext> {
  const supabase = getSupabase();
  const trimmed = phone.trim();
  const [pkgRes, dogRes, historyRes, boardingRes] = await Promise.all([
    supabase.from("packages").select("*").eq("phone", trimmed),
    supabase.from("dogs").select("*").eq("phone", trimmed).order("created_at", { ascending: true }),
    // Not date-limited, for the multi-day boarding reason above.
    supabase
      .from("signins")
      .select(
        // meet_greet_result so the kiosk can tell a dog that has passed its
        // assessment from one still waiting for it.
        "id, dog_name, dog_id, action, service_type, addons, bath_size, price, created_at, meet_greet_result"
      )
      .eq("phone", trimmed)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.from("boardings").select("*").eq("phone", trimmed),
  ]);
  if (pkgRes.error) throw pkgRes.error;
  if (dogRes.error) throw dogRes.error;
  if (historyRes.error) throw historyRes.error;
  if (boardingRes.error) throw boardingRes.error;

  return {
    // Retired dogs are not offered at the kiosk. Nobody should be asked to
    // check in a dog that died, and an owner tapping through a familiar
    // screen would not notice the extra name until it was on the bill.
    // History is untouched — the visits below still reference them.
    dogs: activeDogs((dogRes.data as Dog[]) ?? []),
    packages: (pkgRes.data as Package[]) ?? [],
    boardings: (boardingRes.data as Boarding[]) ?? [],
    openVisits: buildOpenVisits((historyRes.data as SignInRecord[]) ?? []),
    history: (historyRes.data as Partial<SignInRecord>[]) ?? [],
  };
}

// Walks history in order: the last drop-off and last pick-up per dog decide
// whether it's currently checked in, and under which service.
export function buildOpenVisits(
  rows: Partial<SignInRecord>[],
  now: Date = new Date()
): Map<string, OpenVisit> {
  const lastDropOff = new Map<string, OpenVisit>();
  const lastPickUp = new Map<string, Date>();
  // A drop-off timestamped in the future is not a dog standing in the lobby,
  // and treating it as one is unrecoverable: it is always later than every
  // pick-up, so the visit can never be closed and each sign-out prices the
  // stay again. Small tolerance for clock skew between devices.
  const horizon = now.getTime() + 60_000;
  for (const r of rows) {
    if (!r.dog_id || !r.created_at) continue;
    if (new Date(r.created_at).getTime() > horizon) continue;
    if (r.action === "drop_off") {
      lastDropOff.set(r.dog_id, {
        serviceType: (r.service_type as ServiceType) ?? "daycare",
        dropOffTime: new Date(r.created_at),
        addons: r.addons ?? [],
        bathSize: r.bath_size ?? null,
        packageOptOut: r.package_opt_out ?? undefined,
      });
    } else {
      lastPickUp.set(r.dog_id, new Date(r.created_at));
    }
  }
  const open = new Map<string, OpenVisit>();
  lastDropOff.forEach((drop, dogId) => {
    const pickUp = lastPickUp.get(dogId);
    if (!pickUp || drop.dropOffTime > pickUp) open.set(dogId, drop);
  });
  return open;
}

// Whether this visit draws a day from a package.
//
// A full day (over 4 hours) takes one automatically — that is what the block
// was bought for, and making staff opt in every time was just a step to
// forget. A short visit does NOT take one on its own: spending a whole day
// on two hours is rarely what the client wants, and they cannot get it back.
//
// But it is theirs to spend. `explicit` is set when staff actually picked the
// block for this visit, and then a short visit uses it too — and is billed at
// zero rather than the half-day rate, because a day has been spent.
export function packageApplies(
  serviceType: ServiceType,
  open: OpenVisit | null | undefined,
  pkg: Package | null | undefined,
  now: Date,
  explicit = false
): boolean {
  if (!pkg || !open) return false;
  if (serviceType !== "daycare") return false;
  if (pkg.total_days - pkg.days_used <= 0) return false;
  // Three rules, most deliberate first. An explicit pick — someone tapping
  // a specific block right now — wins outright. Failing that, staff having
  // said No day used on the sign-in list beats the automatic rule. Only when
  // nobody has said anything does the length of the visit decide.
  if (explicit) return true;
  if (open.packageOptOut) return false;
  return isFullDayVisit(open.dropOffTime, now);
}

// A walk package covers the walk add-on on a daycare visit. Unlike a
// daycare package it doesn't care how long the dog stayed — a walk is a
// walk — it only needs a walk to have actually been booked, and uses left.
export function walkPackageApplies(
  open: OpenVisit | null | undefined,
  walkPkg: Package | null | undefined
): boolean {
  if (!walkPkg || !open) return false;
  if (!(open.addons ?? []).includes("walk")) return false;
  return walkPkg.total_days - walkPkg.days_used > 0;
}

export interface SignInInput {
  dog: Dog;
  action: SignAction;
  serviceType: ServiceType;
  phone: string;
  byName: string; // who handed the dog over / collected it
  addons: string[];
  pickupWindow?: string | null;
  // Bath size for a drop-off, when it's already known — a boarding
  // reservation books one, so the visit shouldn't wait for staff to retype
  // it on /records before the bath can be priced. Null for a walk-in bath,
  // which genuinely has no price until staff size it.
  bathSize?: BathSize | null;
  openVisit?: OpenVisit | null;
  // Which package this visit should draw from, when one applies. Staff can
  // override the default pick; see eligiblePackagesFor in lib/clients.ts.
  pkg?: Package | null;
  // True when staff chose that block for this visit rather than it being the
  // resolved default. Only that makes a short visit spend a day — see
  // packageApplies.
  pkgExplicit?: boolean;
  // The walk package this visit's walk add-on should draw from, if any.
  // Daycare only — see the note on usingWalkPackage in performSignIn.
  walkPkg?: Package | null;
  // Packages bought on this same visit, which the client pays for now.
  packagesSold?: { days: number; price: number; unit?: string }[] | null;
  byStaff?: boolean;
  now?: Date;
}

export interface SignInResult {
  dogName: string;
  /** Short description of what was charged, for a receipt line. */
  priceLabel?: string;
  daysLeft: number | null;
  priceDue: number | null;
  usedPackage: boolean;
  usedWalkPackage: boolean;
  /**
   * The visit was already closed, so nothing was written. `priceDue` is the
   * charge already on the books, not a new one. Callers should say so rather
   * than reporting a fresh sign-out.
   */
  alreadyClosed?: boolean;
}

export async function performSignIn(input: SignInInput): Promise<SignInResult> {
  const supabase = getSupabase();
  const now = input.now ?? new Date();
  const { dog, action, serviceType, addons, openVisit, pkg } = input;

  // One visit, one charge.
  //
  // A pick-up already recorded after this visit's drop-off means the visit is
  // closed and its price is settled. Writing another would bill the client for
  // the same stay twice — which is what a second tap on "Pay now" did, because
  // paying signs the dog out first and nothing here objected to doing it
  // again. Checked against the database rather than component state, so a
  // double tap, a back-button replay and two staff at the same counter are all
  // covered.
  if (action === "pick_up" && openVisit && dog.id) {
    const { data: closed, error: closedErr } = await supabase
      .from("signins")
      .select("id, price")
      .eq("dog_id", dog.id)
      .eq("action", "pick_up")
      .gt("created_at", openVisit.dropOffTime.toISOString())
      .order("created_at", { ascending: true })
      .limit(1);
    if (closedErr) {
      // Failing open would risk the double charge this exists to prevent.
      console.error("Could not check whether the visit was already closed:", closedErr);
      throw closedErr;
    }
    const existing = (closed as { id: string; price: number | null }[] | null)?.[0];
    if (existing) {
      return {
        dogName: dog.dog_name,
        alreadyClosed: true,
        priceLabel: undefined,
        daysLeft: null,
        priceDue: existing.price ?? null,
        usedPackage: false,
        usedWalkPackage: false,
      };
    }
  }

  let usingPackage = false;
  let usingWalkPackage = false;
  let daysLeft: number | null = null;
  let priceDue: number | null = null;
  let priceLabel: string | null = null;

  // Package days are only consumed at pick-up, once the visit length is
  // known — a full-day-only benefit can't be decided at drop-off.
  // Consumes one use from a package and records it in the ledger. Shared by
  // daycare and walk packages — the only difference is what triggers it.
  // Decided up front so pricing knows, but only written after the sign-in
  // row exists — the ledger rows carry its id so a use is tied to one exact
  // visit rather than guessed at by date.
  // A walk package covers the DAYCARE walk add-on and nothing else.
  //
  // A boarding stay's walks are part of what the reservation bills for, per
  // walk, so a block must not absorb them — the client would be getting those
  // walks twice. A boarding drop-off also copies the walk add-on across from
  // the reservation, which is what made this fire on boarding at all.
  usingWalkPackage =
    action === "pick_up" &&
    serviceType !== "boarding" &&
    !!input.walkPkg?.id &&
    walkPackageApplies(openVisit, input.walkPkg);
  usingPackage =
    action === "pick_up" &&
    !!pkg?.id &&
    packageApplies(serviceType, openVisit, pkg, now, !!input.pkgExplicit);
  if (usingPackage && pkg) daysLeft = pkg.total_days - Math.min(pkg.total_days, pkg.days_used + 1);

  // A package only covers the base full-day rate, so add-ons still apply on
  // top. Boarding never uses packages and always gets its nightly math.
  if (action === "pick_up" && openVisit) {
    const estimate = estimatePrice(
      serviceType,
      openVisit.dropOffTime,
      now,
      openVisit.addons,
      usingPackage,
      // The size stored at drop-off, or the one this dog's weight puts it in.
      // A bath with no size is charged nothing, and every bath added at the
      // kiosk used to have no size — so this is the safety net for visits
      // opened before the kiosk started recording one.
      openVisit.bathSize ?? bathSizeForWeight(input.dog.weight_lb),
      true,
      // Keeps the recorded price matching the estimate the client was
      // shown. /daily counts package sales as their own category and
      // doesn't sum signin prices into revenue, so this can't double-count.
      input.packagesSold ?? null,
      usingWalkPackage
    );
    priceDue = estimate?.amount ?? null;
    priceLabel = estimate?.label ?? null;
  }

  const { data: inserted, error: err } = await supabase.from("signins").insert({
    dog_name: dog.dog_name,
    phone: input.phone.trim(),
    drop_off_by: action === "drop_off" ? input.byName.trim() : "",
    pick_up_by: action === "pick_up" ? input.byName.trim() : "",
    last_name: dog.last_name,
    action,
    service_type: serviceType,
    addons,
    package_id: pkg?.id ?? null,
    dog_id: dog.id,
    price: priceDue,
    pickup_window: action === "drop_off" ? (input.pickupWindow ?? null) : null,
    bath_size:
      action === "drop_off" && addons.includes("bath") ? (input.bathSize ?? null) : null,
    by_staff: !!input.byStaff,
    signature_data: "", // waiver already on file from signup
  })
    .select("id")
    .single();
  if (err) throw err;

  const signinId = (inserted as { id?: string } | null)?.id ?? null;

  // Staff can pick the package on /in-house before the dog is signed out,
  // and that already deducts a use so the count updates on screen. When the
  // dog is then signed out we must NOT deduct a second one — we adopt the
  // use that is already there and tie it to this visit.
  //
  // Returns true when an existing use covered it.
  async function adoptExistingUse(target: Package): Promise<boolean> {
    if (!dog.id) return false;
    const wantKind = target.kind ?? "daycare";

    const { data: uses, error } = await supabase
      .from("package_uses")
      .select("id, package_id")
      .eq("dog_id", dog.id)
      .eq("used_on", todayKey())
      .is("signin_id", null);
    if (error) {
      console.error("Checking for an existing package use failed:", error);
      return false;
    }
    const rows = (uses as { id: string; package_id: string }[] | null) ?? [];
    if (!rows.length) return false;

    // Match on KIND, not on the exact package. If staff earmarked block A
    // and the default here resolves to block B, the visit still owes one
    // walk — taking one from each would charge the client twice, and staff's
    // explicit choice is the one that should stand.
    const { data: pkgs } = await supabase
      .from("packages")
      .select("id, kind")
      .in("id", rows.map((r) => r.package_id));
    const sameKind = new Set(
      ((pkgs as { id: string; kind: string | null }[] | null) ?? [])
        .filter((k) => (k.kind ?? "daycare") === wantKind)
        .map((k) => k.id)
    );
    const found = rows.find((r) => sameKind.has(r.package_id));
    if (!found) return false;

    const { error: linkErr } = await supabase
      .from("package_uses")
      .update({ signin_id: signinId })
      .eq("id", found.id);
    if (linkErr) console.error("Linking the existing package use failed:", linkErr);
    return true;
  }

  // Consumes one use and records it against this visit. Shared by daycare and
  // walk packages — only the trigger differs. Always exactly one: a visit
  // draws a single day or a single walk, and boarding no longer draws at all.
  async function consume(target: Package) {
    const newUsed = Math.min(target.total_days, target.days_used + 1);
    if (newUsed === target.days_used) return; // block already exhausted
    const { error: pkgErr } = await supabase
      .from("packages")
      .update({ days_used: newUsed })
      .eq("id", target.id);
    if (pkgErr) {
      console.error("Deducting the package failed:", pkgErr);
      return;
    }
    const { error: useErr } = await supabase.from("package_uses").insert({
      package_id: target.id,
      dog_id: dog.id ?? null,
      signin_id: signinId,
      dog_name: dog.dog_name,
      used_on: todayKey(),
    });
    // Not fatal — the deduction itself already stuck.
    if (useErr) console.error("Recording package use failed:", useErr);
  }

  if (usingWalkPackage && input.walkPkg) {
    if (!(await adoptExistingUse(input.walkPkg))) await consume(input.walkPkg);
  }
  if (usingPackage && pkg) {
    if (!(await adoptExistingUse(pkg))) await consume(pkg);
  }

  return {
    dogName: dog.dog_name,
    priceLabel: priceLabel ?? undefined,
    daysLeft,
    priceDue,
    usedPackage: usingPackage,
    usedWalkPackage: usingWalkPackage,
  };
}
