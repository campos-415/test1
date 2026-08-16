import { getSettings } from "@/lib/settings";

// -----------------------------------------------------------------------
// Walk-in pricing. Covers daycare/boarding base rate, walk/nail-trim
// (fixed the moment picked at drop-off), and bath (priced by size,
// assigned on /records — can happen any time, even mid-visit, and once
// set it's included here too). Returns a structured breakdown so the UI
// can show a line-by-line total, not just one number.
// -----------------------------------------------------------------------

// Every price below is read live from the settings row (lib/settings.ts)
// rather than baked in, so staff can change them on /settings. They're
// exposed as getter objects so existing call sites — PRICING.daycareFullDay,
// BATH_PRICES[size] — keep working untouched, and every pricing function
// here stays pure and synchronous.

export const PRICING = {
  get daycareFullDay() {
    return getSettings().pricing.daycareFullDay;
  },
  get daycareHalfDay() {
    return getSettings().pricing.daycareHalfDay;
  },
  get daycareHalfDayThresholdHours() {
    return getSettings().pricing.daycareHalfDayThresholdHours;
  },
  get boardingPerNight() {
    return getSettings().pricing.boardingPerNight;
  },
  // Never exposed here until now, which is the whole reason the second-dog
  // discount was editable in Settings, printed on the public price table, and
  // charged to nobody: no pricing path could reach the number.
  get boardingSecondDogPerNight() {
    return getSettings().pricing.boardingSecondDogPerNight;
  },
  get latePickupHour() {
    return getSettings().pricing.latePickupHour;
  },
  get latePickupFee() {
    return getSettings().pricing.latePickupFee;
  },
  get daycareLatePickupHour() {
    return getSettings().pricing.daycareLatePickupHour;
  },
  get daycareLatePickupPerHour() {
    return getSettings().pricing.daycareLatePickupPerHour;
  },
  get daycareSecondDogFullDay() {
    return getSettings().pricing.daycareSecondDogFullDay;
  },
  get daycareSecondDogHalfDay() {
    return getSettings().pricing.daycareSecondDogHalfDay;
  },
  get earlyHour() {
    return getSettings().pricing.earlyHour;
  },
  get earlyFee() {
    return getSettings().pricing.earlyFee;
  },
};

// Walk-in add-on prices, applied once selected at drop-off. Indexed by
// add-on key so custom add-ons created on /settings price themselves.
export const ADDON_PRICES: Record<string, number> = new Proxy(
  {},
  {
    get: (_t, key: string) => getSettings().pricing.addons[key] ?? 0,
    has: (_t, key: string) => key in getSettings().pricing.addons,
    ownKeys: () => Reflect.ownKeys(getSettings().pricing.addons),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  }
);

// Bath is priced by size. A boarding reservation books a size, so those
// carry onto the sign-in automatically (see lib/signin.ts); a walk-in bath
// has no size until staff assign one on /records, and until then no bath
// charge applies — /records flags those rows so they can't slip through.
export const BATH_PRICES: Record<"S" | "M" | "L", number> = {
  get S() {
    return getSettings().pricing.bath.S;
  },
  get M() {
    return getSettings().pricing.bath.M;
  },
  get L() {
    return getSettings().pricing.bath.L;
  },
};

/**
 * The bath size a dog's weight puts it in, or null when the weight is not on
 * file.
 *
 * Null rather than a guess, and the callers treat it as "ask somebody". A
 * wrong size here is a wrong price on a real invoice, and the profile not
 * having a weight is a thing staff can fix in ten seconds.
 *
 * The boundaries are inclusive at the top: with S set to 25, a 25 lb dog is
 * small and a 25.5 lb dog is medium. Somebody has to own the boundary and the
 * lower band is the kinder place for it to sit.
 */
export function bathSizeForWeight(weightLb?: number | null): "S" | "M" | "L" | null {
  const weight = typeof weightLb === "number" ? weightLb : Number(weightLb);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const max = getSettings().pricing.bathWeightMax;
  if (weight <= max.S) return "S";
  if (weight <= max.M) return "M";
  return "L";
}

// Boarding add-on pricing. Walk is per walk (so a stay with 2 walks/day
// over 3 nights charges 6 walks); medication is a flat daily fee for
// the whole stay; nail trim is a flat one-time fee for the stay.
//
// Boarding walks always bill. A walk package covers the DAYCARE walk add-on
// and nothing else — a stay's walks are part of what the reservation charges
// for, so letting a block absorb them would give the walks away twice.
export const BOARDING_ADDON_PRICES = {
  get walkPerWalk() {
    return getSettings().pricing.boardingWalkPerWalk;
  },
  get medicationPerDay() {
    return getSettings().pricing.boardingMedicationPerDay;
  },
  get nailTrim() {
    return getSettings().pricing.boardingNailTrim;
  },
};

export interface BoardingAddonInput {
  addons: string[];
  walksPerDay?: number | null;
  bathSize?: "S" | "M" | "L" | null;
}

// A dog's package only covers a visit's base rate when the visit is a
// FULL day. A half-day (4 hours or less) visit is never covered by a
// package — it's always billed as a walk-in half day — so this returns
// false in that case even when hasPackage is true.
export function isBaseCoveredByPackage(
  hasPackage: boolean,
  dropOffTime: Date,
  pickUpTime: Date
): boolean {
  if (!hasPackage) return false;
  return isFullDayVisit(dropOffTime, pickUpTime);
}

// Price breakdown for a boarding reservation's add-ons only (not the
// nightly rate itself — combine with PRICING.boardingPerNight * nights
// separately, e.g. in estimateBoardingTotal below).
// Nights between two "YYYY-MM-DD" keys, minimum 1.
export function nightsBetweenKeys(startDate: string, endDate: string): number {
  return Math.max(
    1,
    Math.round((parseYmd(endDate).getTime() - parseYmd(startDate).getTime()) / 86_400_000)
  );
}

// A boarding stay's add-ons split by category, with counts. The daily
// report needs the amounts attributed to Walks/Baths/etc rather than as one
// lump, and estimateBoardingAddons below builds its labelled breakdown from
// the same numbers — so the report and the invoice can't disagree.
export interface BoardingAddonAmounts {
  walks: number;
  /**
   * Every walk the stay includes. All of them bill: a walk package covers the
   * daycare walk add-on only, and boarding walks are charged per walk on the
   * reservation. See the note above walkPerWalk.
   */
  walkCount: number;
  bath: number;
  bathCount: number;
  nailTrim: number;
  nailTrimCount: number;
  medication: number;
  medicationCount: number;
  total: number;
}

export function boardingAddonAmounts(
  input: BoardingAddonInput,
  nights: number
): BoardingAddonAmounts {
  const addons = input.addons ?? [];
  const perDay = Math.max(1, input.walksPerDay || 1);
  const walkCount = addons.includes("walk") ? perDay * nights : 0;
  const bathCount = addons.includes("bath") && input.bathSize ? 1 : 0;
  const nailTrimCount = addons.includes("nail_trim") ? 1 : 0;
  const medicationCount = addons.includes("medication") ? nights : 0;

  const out = {
    walks: walkCount * BOARDING_ADDON_PRICES.walkPerWalk,
    walkCount,
    bath: bathCount && input.bathSize ? BATH_PRICES[input.bathSize] : 0,
    bathCount,
    nailTrim: nailTrimCount * BOARDING_ADDON_PRICES.nailTrim,
    nailTrimCount,
    medication: medicationCount * BOARDING_ADDON_PRICES.medicationPerDay,
    medicationCount,
    total: 0,
  };
  out.total = out.walks + out.bath + out.nailTrim + out.medication;
  return out;
}

export function estimateBoardingAddons(input: BoardingAddonInput, nights: number): PriceBreakdownItem[] {
  const a = boardingAddonAmounts(input, nights);
  const perDay = Math.max(1, input.walksPerDay || 1);
  const breakdown: PriceBreakdownItem[] = [];
  if (a.walkCount) {
    breakdown.push({
      label: `Walks (${perDay}/day × ${nights} night${nights === 1 ? "" : "s"})`,
      amount: a.walks,
    });
  }
  if (a.bathCount) breakdown.push({ label: `Bath (${input.bathSize})`, amount: a.bath });
  if (a.nailTrimCount) breakdown.push({ label: "Nail trim", amount: a.nailTrim });
  if (a.medicationCount) {
    breakdown.push({
      label: `Medication (${nights} night${nights === 1 ? "" : "s"})`,
      amount: a.medication,
    });
  }
  return breakdown;
}

// Full estimate for a boarding reservation: nightly rate + add-ons.
export function estimateBoardingTotal(
  startDate: string,
  endDate: string,
  addonInput: BoardingAddonInput
): PriceEstimate {
  const nights = nightsBetweenKeys(startDate, endDate);
  const breakdown: PriceBreakdownItem[] = [
    { label: `Boarding (${nights} night${nights === 1 ? "" : "s"})`, amount: nights * PRICING.boardingPerNight },
    ...estimateBoardingAddons(addonInput, nights),
  ];
  const amount = breakdown.reduce((sum, b) => sum + b.amount, 0);
  return { amount, label: breakdown.map((b) => b.label).join(" + "), breakdown };
}

function parseYmd(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export interface PriceBreakdownItem {
  label: string;
  amount: number;
}

export interface PriceEstimate {
  amount: number;
  label: string; // short combined label, e.g. "full day + walk + bath (M)"
  breakdown: PriceBreakdownItem[];
}

// Whole calendar nights between two dates, minimum 1 (a same-day boarding
// drop-off/pick-up still counts as at least one night).
/** "12PM", "7PM", "9AM" — for a receipt, from a 24-hour setting. */
function hourLabel(hour24: number): string {
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const h = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h}${suffix}`;
}

/**
 * Whole hours past a cut-off, rounded up, so 7:05pm against a 7pm cut-off is
 * one hour and not five minutes of one.
 *
 * Rounding up is the convention every daycare uses and the one that matches
 * the cost: a member of staff stayed, and they did not stay for a twelfth of
 * an hour.
 */
function hoursPast(pickUp: Date, cutoffHour: number): number {
  const cutoff = new Date(pickUp);
  cutoff.setHours(cutoffHour, 0, 0, 0);
  const ms = pickUp.getTime() - cutoff.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 3_600_000);
}

function nightsBetween(dropOff: Date, pickUp: Date): number {
  const start = new Date(dropOff.getFullYear(), dropOff.getMonth(), dropOff.getDate());
  const end = new Date(pickUp.getFullYear(), pickUp.getMonth(), pickUp.getDate());
  const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, nights);
}

// A package only ever covers a FULL daycare day — a half-day (4 hours or
// less) visit is always billed as a walk-in half day, package or not.
export function isFullDayVisit(dropOffTime: Date, pickUpTime: Date): boolean {
  const hours = (pickUpTime.getTime() - dropOffTime.getTime()) / 3_600_000;
  return hours > PRICING.daycareHalfDayThresholdHours;
}

export function estimatePrice(
  serviceType: "daycare" | "boarding" | "meet_greet",
  dropOffTime: Date,
  pickUpTime: Date,
  addons: string[] = [],
  baseCovered: boolean = false, // true only when a package covers this visit's FULL-DAY daycare rate
  bathSize: "S" | "M" | "L" | null = null,
  // Whether `pickUpTime` is the real end of the stay rather than a
  // stand-in "now". Only matters for boarding: the late-pickup daycare
  // fee is a last-day charge, so a running mid-stay estimate must not
  // add it just because the clock has passed noon on some earlier day.
  isFinalPickUp: boolean = true,
  // A package the client bought on this visit. The sale is money changing
  // hands today, so it belongs in today's total — but only today. Later
  // visits merely spend days that were already paid for.
  packagesSold: { days: number; price: number; unit?: string }[] | null = null,
  // True when a walk package covers this visit's walk add-on, the walk
  // equivalent of baseCovered.
  walkCovered: boolean = false,
  // The second or a later dog from the same household on the same day, which
  // every daycare charges less for. The caller decides this, because only the
  // caller can see the household: the kiosk knows which dogs were selected
  // together, and the sign-out path asks the database.
  //
  // Add-ons are untouched by it. A second bath is a second bath.
  additionalDog: boolean = false
): PriceEstimate | null {
  const breakdown: PriceBreakdownItem[] = [];

  for (const sold of packagesSold ?? []) {
    breakdown.push({
      label: `Package (${sold.days} ${sold.unit ?? "days"})`,
      amount: sold.price,
    });
  }

  if (baseCovered) {
    // The package absorbs the base rate. Show it as a $0 line rather than
    // dropping it: silently omitting the base makes the total look like the
    // daycare charge went missing, and a package-covered day with no add-ons
    // would otherwise produce no breakdown at all.
    //
    // A short visit can be covered too, when staff spend a day on it
    // deliberately. Naming it "full day" there would be a lie on the
    // receipt, and the half-day fee is not charged on top — the day paid
    // for the visit, whatever its length.
    const fullDay = isFullDayVisit(dropOffTime, pickUpTime);
    breakdown.push({
      label: `Daycare (${fullDay ? "full day" : "half day"}) — covered by package`,
      amount: 0,
    });
  } else {
    if (serviceType === "daycare") {
      const fullDay = isFullDayVisit(dropOffTime, pickUpTime);
      // The second-dog rate, when there is one. Falling back to the full rate
      // rather than to zero: a business that has not set a discount charges
      // the ordinary price, and a blank field must never make a day free.
      const second = fullDay ? PRICING.daycareSecondDogFullDay : PRICING.daycareSecondDogHalfDay;
      const standard = fullDay ? PRICING.daycareFullDay : PRICING.daycareHalfDay;
      const discounted = additionalDog && second > 0;
      breakdown.push({
        label: `Daycare (${fullDay ? "full day" : "half day"})${discounted ? " — second dog" : ""}`,
        amount: discounted ? second : standard,
      });
    } else if (serviceType === "boarding") {
      const nights = nightsBetween(dropOffTime, pickUpTime);
      const second = PRICING.boardingSecondDogPerNight;
      const discounted = additionalDog && second > 0;
      const rate = discounted ? second : PRICING.boardingPerNight;
      breakdown.push({
        label: `Boarding (${nights} night${nights === 1 ? "" : "s"})${discounted ? " — second dog" : ""}`,
        amount: nights * rate,
      });
    }
  }

  // ---- Late pick-up -------------------------------------------------
  //
  // Outside the package branch above, deliberately. A package buys a day of
  // daycare; it does not buy the staff time after closing. This charge used
  // to sit inside the un-covered branch, so a dog on a package collected at
  // eight in the evening cost nothing extra.
  //
  // Two rules, because daycares have two. Boarding is a flat fee once, on
  // the day the dog actually goes home. Daycare is by the hour, because the
  // cost is somebody waiting.
  // ---- Before the doors open ----------------------------------------
  //
  // Charged once per visit, not once per end of it: somebody opened up early
  // for this dog, and they did not do it twice because the dog also went home
  // early. Either end being before the hour is enough.
  //
  // Outside the package branch for the same reason as late pick-up — a
  // package buys a day of daycare, not staff time before opening.
  if (PRICING.earlyFee > 0) {
    const early =
      dropOffTime.getHours() < PRICING.earlyHour ||
      (isFinalPickUp && pickUpTime.getHours() < PRICING.earlyHour);
    if (early) {
      breakdown.push({
        label: `Early (before ${hourLabel(PRICING.earlyHour)})`,
        amount: PRICING.earlyFee,
      });
    }
  }

  if (isFinalPickUp) {
    if (serviceType === "daycare" && PRICING.daycareLatePickupPerHour > 0) {
      const hoursLate = hoursPast(pickUpTime, PRICING.daycareLatePickupHour);
      if (hoursLate > 0) {
        breakdown.push({
          label: `Late pick-up (after ${hourLabel(PRICING.daycareLatePickupHour)}) — ${hoursLate} hr`,
          amount: hoursLate * PRICING.daycareLatePickupPerHour,
        });
      }
    } else if (serviceType === "boarding" && PRICING.latePickupFee > 0) {
      if (pickUpTime.getHours() >= PRICING.latePickupHour) {
        breakdown.push({
          // Was hardcoded as "after 12PM", so changing the hour in Settings
          // left the receipt naming an hour nobody was charged by.
          label: `Late pick-up (after ${hourLabel(PRICING.latePickupHour)})`,
          amount: PRICING.latePickupFee,
        });
      }
    }
  }

  if (addons.includes("walk")) {
    // Same treatment as a package-covered daycare day: shown as a $0 line
    // rather than dropped, so the walk doesn't look like it went missing.
    breakdown.push(
      walkCovered
        ? { label: "Walk — covered by package", amount: 0 }
        : { label: "Walk", amount: ADDON_PRICES.walk }
    );
  }
  if (addons.includes("nail_trim")) breakdown.push({ label: "Nail trim", amount: ADDON_PRICES.nail_trim });
  if (bathSize) breakdown.push({ label: `Bath (${bathSize})`, amount: BATH_PRICES[bathSize] });

  if (!breakdown.length) return null;

  const amount = breakdown.reduce((sum, b) => sum + b.amount, 0);
  const label = breakdown.map((b) => b.label).join(" + ");
  return { amount, label, breakdown };
}
