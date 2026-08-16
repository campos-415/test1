// Shared lookup rules for resolving a dog's profile and its package.
// Both were previously duplicated across app/records/page.tsx,
// components/KioskForm.tsx, and app/report/page.tsx — they live here so
// every page agrees on what "this dog's package" means.

import { dateKey as localDateKey } from "@/lib/dates";
import { Dog, Package, PackageKind } from "@/types";

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export interface DogRef {
  dogId?: string | null;
  dogName?: string | null;
  phone?: string | null;
}

// Resolves a dog's client profile. Prefers dog_id, since that's exact,
// and falls back to dog name + phone for rows written before the kiosk
// started recording dog_id.
export function findDog(dogs: Dog[], ref: DogRef): Dog | null {
  if (ref.dogId) {
    const byId = dogs.find((c) => c.id === ref.dogId);
    if (byId) return byId;
  }
  if (ref.dogName && ref.phone) {
    return dogs.find((c) => sameName(c.dog_name, ref.dogName) && c.phone === ref.phone) ?? null;
  }
  return null;
}

export function daysLeft(pkg: Package): number {
  return Math.max(0, pkg.total_days - pkg.days_used);
}

// A dog is covered either by a signature captured at signup, or by staff
// confirming a waiver signed elsewhere (paper, another location).
export function hasWaiver(dog: Dog): boolean {
  return !!dog.signature_data || !!dog.waiver_on_file;
}

// Every package that could cover a visit for this dog: ones bought
// specifically for them first, then ones with no dog_name, which are
// shared across every dog on the number. Packages with days remaining
// come before exhausted ones, and within each group the newest wins.
//
// A visit only ever consumes a day from ONE of these — see
// findPackageFor for the default pick and the kiosk's per-dog package
// selector for overriding it.
export function packageKind(p: Package): PackageKind {
  return p.kind ?? "daycare"; // rows predating walk packages are all daycare
}

export function eligiblePackagesFor(
  packages: Package[],
  phone: string,
  dogName: string,
  kind: PackageKind = "daycare"
): Package[] {
  const rank = (p: Package) => {
    const dogSpecific = p.dog_name && sameName(p.dog_name, dogName) ? 0 : 1;
    const exhausted = daysLeft(p) > 0 ? 0 : 1;
    // Exhausted-vs-not dominates: a used-up dog-specific package
    // shouldn't outrank a shared one that still has days on it.
    return exhausted * 2 + dogSpecific;
  };
  return packages
    .filter((p) => p.phone === phone)
    .filter((p) => packageKind(p) === kind)
    .filter((p) => !p.dog_name || sameName(p.dog_name, dogName))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );
}

// The package a visit draws from unless staff pick a different one.
//
// A dog can have a package pinned on its profile; that wins as long as it
// still has uses left. An exhausted pin is ignored rather than blocking the
// visit — staff pinned a block, not a dead end.
export function findPackageFor(
  packages: Package[],
  phone: string,
  dogName: string,
  kind: PackageKind = "daycare",
  preferredId?: string | null
): Package | null {
  const eligible = eligiblePackagesFor(packages, phone, dogName, kind);
  if (preferredId) {
    const pinned = eligible.find((p) => p.id === preferredId && daysLeft(p) > 0);
    if (pinned) return pinned;
  }
  return eligible[0] ?? null;
}

// The pinned package id for a kind, as stored on the dog.
export function preferredPackageId(dog: Dog | null, kind: PackageKind): string | null {
  if (!dog) return null;
  return (kind === "walk" ? dog.default_walk_package_id : dog.default_package_id) ?? null;
}

// Packages this dog's household bought on a given day. The sale is what
// the client actually pays on that visit, so it belongs in that day's
// total — but only that day. Later visits just spend the uses it bought,
// which are already paid for and bill at $0.
//
// Returns every match, since a client can buy a daycare package and a walk
// package in the same visit and both are owed today.
export function packagesBoughtOn(
  packages: Package[],
  phone: string,
  dogName: string,
  dateKey: string
): Package[] {
  return (
    packages.filter(
      (p) =>
        p.phone === phone &&
        (!p.dog_name || sameName(p.dog_name, dogName)) &&
        // created_at is a UTC timestamp; compare it in local time so an
        // evening sale isn't attributed to the next day.
        !!p.created_at &&
        localDateKey(new Date(p.created_at)) === dateKey &&
        p.price != null
    ) ?? []
  );
}

// Which pick-up a package sale is billed to: the EARLIEST priced pick-up
// at or after the moment it was sold, on the same day. Returns null when no
// such pick-up exists yet — the sale is still unbilled.
//
// "Any pick-up that day" is the tempting rule and it's wrong three ways: a
// dog returning for a second visit gets charged the package twice, a later
// visit can steal the charge away from the one that actually paid it, and a
// sale made after the day's last pick-up looks billed when no saved price
// could contain it.
export function packageBillingPickUp<T extends { id?: string; price?: number | null; created_at?: string }>(
  pkg: Package,
  pickUps: T[]
): T | null {
  if (!pkg.created_at) return null;
  const soldAt = new Date(pkg.created_at).getTime();
  const day = localDateKey(new Date(pkg.created_at));
  const candidates = pickUps
    .filter(
      (p) =>
        p.price != null &&
        !!p.created_at &&
        localDateKey(new Date(p.created_at)) === day &&
        new Date(p.created_at).getTime() >= soldAt
    )
    .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime());
  return candidates[0] ?? null;
}

// A short label distinguishing one of a household's packages from another
// in a picker — "Bella · 6 of 10 left" vs "Shared · 2 of 5 left".
//
// `held` counts uses this screen has earmarked but that aren't on the ledger
// yet. A boarding stay spends its walks in one go at pick-up, so days_used
// still reads zero while four of them are already promised — and a picker
// that answers "10 of 10 left" invites staff to promise the same four walks
// to a second stay. Held uses are display only; the ledger stays the single
// source of truth for what has actually been spent.
export function packageLabel(pkg: Package, held = 0): string {
  const scope = pkg.dog_name ? pkg.dog_name : "Shared";
  const unit = packageKind(pkg) === "walk" ? "walks" : "days";
  const reserved = Math.max(0, Math.min(daysLeft(pkg), held));
  const left = daysLeft(pkg) - reserved;
  return `${scope} · ${left} of ${pkg.total_days} ${unit} left${
    reserved ? ` (${reserved} held)` : ""
  }`;
}

// Owner profiles are keyed by phone. The stored strings aren't all
// normalized (older rows predate formatPhoneInput), so the exact string is
// encoded into the route rather than reconstructed from digits.
export function ownerHref(phone: string): string {
  return `/owners/${encodeURIComponent(phone)}`;
}

export function dogHref(dogId: string): string {
  return `/dogs/${dogId}`;
}
