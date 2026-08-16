// One day's business, summarized. Shared by the dashboard's glanceable
// panel and the printable end-of-day report so both quote the same
// numbers — all amounts come from lib/pricing.ts, never a second table of
// prices.

import { Boarding, Package, PackageUse, ServiceType, SignInRecord } from "@/types";
import { getSupabase } from "@/lib/supabase";
import { isBaseCoveredByPackage } from "@/lib/pricing";
// ...


import {
  ADDON_PRICES,
  BATH_PRICES,
  PRICING,
  boardingAddonAmounts,
  isFullDayVisit,
  nightsBetweenKeys,
} from "@/lib/pricing";

export interface DailyTotals {
  scheduledToArrive: number;
  revenue: Category[];
  // How much work the day holds, as counts rather than money — what the
  // dashboard shows. Revenue stays on the printable /daily report.
  scheduled: Category[];
  dogsByService: Category[];
  revenueTotal: number;
  chargedTotal: number;
  dropOffs: SignInRecord[];
  pickUps: SignInRecord[];
  packageDaysUsed: number;
  // Boarding revenue still in progress — dogs currently checked in whose
  // stay covers today but who haven't been picked up yet. Not part of
  // revenueTotal; it's a forecast, not money earned.
  projectedRevenue: number;
  projectedCount: number;
}


export function computeDailyTotals({
  signins,
  boardings,
  packageUses,
  packagesSold,
  selectedDate,
}: DailyInput): DailyTotals {
  const dateKey = selectedDate ?? new Date().toISOString().slice(0, 10);
  const dropOffs = signins.filter((s) => s.action === "drop_off");
  const pickUps = signins.filter((s) => s.action === "pick_up");

  let daycareFull = 0;
  let daycareFullCount = 0;
  let daycareHalf = 0;
  let daycareHalfCount = 0;
  let walks = 0;
  let walkCount = 0;
  let baths = 0;
  let bathCount = 0;
  let nails = 0;
  let nailCount = 0;
  let medication = 0;
  let medicationCount = 0;

  for (const p of pickUps) {
    if (p.service_type !== "daycare") continue;
    const drop = dropOffs.find(
      (d) =>
        d.dog_id &&
        d.dog_id === p.dog_id &&
        d.service_type === "daycare",
    );
    const full =
      drop?.created_at && p.created_at
        ? isFullDayVisit(new Date(drop.created_at), new Date(p.created_at))
        : true;

    // A package only covers the FULL-day rate — a half-day visit is
    // always charged, package or not.
    const hasPackage = packageUses.some(
      (u) => u.dog_id && u.dog_id === p.dog_id,
    );
    if (hasPackage && full) continue;

    if (full) {
      daycareFull += PRICING.daycareFullDay;
      daycareFullCount++;
    } else {
      daycareHalf += PRICING.daycareHalfDay;
      daycareHalfCount++;
    }
  }

  for (const d of dropOffs) {
    // Boarding add-ons are counted from the reservation below, not here. The
    // kiosk copies a stay's add-ons onto its drop-off row so the parent can
    // see them, so counting both places would bill and tally each boarding
    // walk twice — and at the wrong rate, since boarding walks are priced
    // per walk rather than at the walk-in rate.
    if (d.service_type === "boarding") continue;
    const addons = d.addons ?? [];
    if (addons.includes("walk")) {
      walks += ADDON_PRICES.walk;
      walkCount++;
    }
    if (addons.includes("nail_trim")) {
      nails += ADDON_PRICES.nail_trim;
      nailCount++;
    }
    if (addons.includes("bath")) {
      if (d.bath_size) baths += BATH_PRICES[d.bath_size];
      bathCount++;
    }
  }

  // Boarding stays starting today that haven't been dropped off yet.
  const arrivedDogIds = new Set(
    dropOffs
      .filter((d) => d.service_type === "boarding")
      .map((d) => d.dog_id),
  );
  const scheduledToArrive = boardings.filter(
    (b) =>
      b.start_date === /* selectedDate, needs to be passed in */ dateKey &&
      !arrivedDogIds.has(b.dog_id),
  ).length;

  // Boarding revenue is realized at checkout, not accrued nightly. A stay
  // covering today either closed out today (dog was picked up — its full
  // stay total counts as today's revenue) or is still ongoing (its total
  // is a projection, tracked separately, until the dog actually leaves).
  const boardingPickUps = pickUps.filter((p) => p.service_type === "boarding");

  let boardingActual = 0;
  let boardingActualCount = 0;
  let projectedRevenue = 0;
  let projectedCount = 0;

  for (const b of boardings) {
    const nights = nightsBetweenKeys(b.start_date, b.end_date);
    const addonInput = {
      addons: b.addons ?? [],
      walksPerDay: b.walks_per_day ?? null,
      bathSize: b.bath_size ?? null,
      // Walks a package already paid for are not revenue today — that money
      // was counted on the day the block was sold.
    };
    const base = nights * PRICING.boardingPerNight;
    const extras = boardingAddonAmounts(addonInput, nights);

    const pickedUpToday = boardingPickUps.some(
      (p) => p.dog_id && p.dog_id === b.dog_id,
    );

    if (pickedUpToday) {
      // Nothing is billed until the dog leaves, and then the whole stay
      // lands at once. Split across categories rather than shown as one
      // boarding lump, so grooming and walk revenue is visible wherever it
      // came from — the Boarding line is the nightly rate only.
      boardingActual += base;
      boardingActualCount++;
      walks += extras.walks;
      walkCount += extras.walkCount;
      baths += extras.bath;
      bathCount += extras.bathCount;
      nails += extras.nailTrim;
      nailCount += extras.nailTrimCount;
      medication += extras.medication;
      medicationCount += extras.medicationCount;
    } else {
      projectedRevenue += base + extras.total;
      projectedCount++;
    }
  }

  const revenue: Category[] = [
    {
      key: "daycare_full",
      label: "Daycare (full)",
      amount: daycareFull,
      count: daycareFullCount,
      color: "#4A72EF",
      service: "daycare",
    },
    {
      key: "daycare_half",
      label: "Daycare (half)",
      amount: daycareHalf,
      count: daycareHalfCount,
      color: "#7C9AF5",
      service: "daycare",
    },
    {
      key: "boarding",
      label: "Boarding nights (checked out)",
      amount: boardingActual,
      count: boardingActualCount,
      color: "#0EA5E9",
      service: "boarding",
    },
    {
      key: "walks",
      label: "Walks",
      amount: walks,
      count: walkCount,
      color: "#10B981",
    },
    {
      key: "baths",
      label: "Baths",
      amount: baths,
      count: bathCount,
      color: "#F59E0B",
    },
    {
      key: "nails",
      label: "Nail trims",
      amount: nails,
      count: nailCount,
      color: "#F97316",
    },
    {
      key: "medication",
      label: "Medication",
      amount: medication,
      count: medicationCount,
      color: "#EF4444",
    },
    // Selling a package IS the revenue — the client pays the package price
    // up front instead of a daycare fee, and the visits it later covers are
    // excluded above precisely because the money was taken here.
    {
      key: "packages",
      label: "Packages sold",
      amount: (packagesSold ?? []).reduce((sum, p) => sum + (p.price ?? 0), 0),
      count: (packagesSold ?? []).length,
      color: "#8B5CF6",
    },
  ];

  // What the day holds, counted rather than priced. Per-day things (walks,
  // medication) count for every stay covering the day; one-off grooming on a
  // boarding stay is counted on its pick-up day, since that's when a dog is
  // bathed before going home.
  let walksScheduled = walkCount;
  let bathsScheduled = bathCount;
  let nailsScheduled = nailCount;
  let medsScheduled = 0;
  for (const b of boardings) {
    const addons = b.addons ?? [];
    if (addons.includes("walk")) walksScheduled += Math.max(1, b.walks_per_day ?? 1);
    if (addons.includes("medication")) medsScheduled++;
    if (b.end_date === dateKey) {
      if (addons.includes("bath")) bathsScheduled++;
      if (addons.includes("nail_trim")) nailsScheduled++;
    }
  }

  const scheduled: Category[] = [
    { key: "walks", label: "Walks", amount: walksScheduled, count: walksScheduled, color: "#10B981" },
    { key: "baths", label: "Baths", amount: bathsScheduled, count: bathsScheduled, color: "#F59E0B" },
    {
      key: "nails",
      label: "Nail trims",
      amount: nailsScheduled,
      count: nailsScheduled,
      color: "#F97316",
    },
    {
      key: "meds",
      label: "Medications",
      amount: medsScheduled,
      count: medsScheduled,
      color: "#A855F7",
    },
  ];

  const daycareDogs = dropOffs.filter(
    (d) => d.service_type === "daycare",
  ).length;
  const meetDogs = dropOffs.filter(
    (d) => d.service_type === "meet_greet",
  ).length;
  const dogsByService: Category[] = [
    {
      key: "daycare",
      label: "Daycare",
      amount: daycareDogs,
      count: daycareDogs,
      color: "#4A72EF",
      service: "daycare",
    },
    {
      key: "boarding",
      label: "Boarding",
      amount: boardings.length,
      count: boardings.length,
      color: "#0EA5E9",
      service: "boarding",
    },
    {
      key: "meet",
      label: "Meet & greet",
      amount: meetDogs,
      count: meetDogs,
      color: "#A855F7",
      service: "meet_greet",
    },
  ];

  return {
    revenue,
    scheduled,
    dogsByService,
    revenueTotal: revenue.reduce((sum, c) => sum + c.amount, 0),
    chargedTotal: pickUps.reduce((sum, p) => sum + (p.price ?? 0), 0),
    dropOffs,
    pickUps,
    packageDaysUsed: packageUses.length,
    projectedRevenue,
    projectedCount,
    scheduledToArrive,
  };
}
export interface Category {
  key: string;
  label: string;
  amount: number;
  count: number;
  color: string;
  // Which service's sign-in list this category drills into, if any.
  service?: ServiceType;
}


export interface DailyInput {
  signins: SignInRecord[];
  boardings: Boarding[]; // already narrowed to stays covering the day
  packageUses: PackageUse[];
  packagesSold: Package[]; // packages bought that day — the revenue event
  // Every package on file, not just today's sales. Needed to work out how
  // many of a stay's walks a block still has left to cover.
  selectedDate?: string;
}

// export function computeDailyTotals({ signins, boardings, packageUses }: DailyInput): DailyTotals {
//   const dropOffs = signins.filter((s) => s.action === "drop_off");
//   const pickUps = signins.filter((s) => s.action === "pick_up");

//   let daycareFull = 0;
//   let daycareFullCount = 0;
//   let daycareHalf = 0;
//   let daycareHalfCount = 0;
//   let walks = 0;
//   let walkCount = 0;
//   let baths = 0;
//   let bathCount = 0;
//   let nails = 0;
//   let nailCount = 0;

//   // A daycare visit is only billable once picked up — that's also the only
//   // point its length, and so its rate, is known.
//   for (const p of pickUps) {
//     if (p.service_type !== "daycare") continue;
//     const covered = packageUses.some((u) => u.dog_id && u.dog_id === p.dog_id);
//     if (covered) continue;
//     const drop = dropOffs.find(
//       (d) => d.dog_id && d.dog_id === p.dog_id && d.service_type === "daycare"
//     );
//     const full =
//       drop && drop.created_at && p.created_at
//         ? isFullDayVisit(new Date(drop.created_at), new Date(p.created_at))
//         : true;
//     if (full) {
//       daycareFull += PRICING.daycareFullDay;
//       daycareFullCount++;
//     } else {
//       daycareHalf += PRICING.daycareHalfDay;
//       daycareHalfCount++;
//     }
//   }
  

//   // Add-ons are chosen at drop-off, so they count from that row.
//   for (const d of dropOffs) {
//     const addons = d.addons ?? [];
//     if (addons.includes("walk")) {
//       walks += ADDON_PRICES.walk;
//       walkCount++;
//     }
//     if (addons.includes("nail_trim")) {
//       nails += ADDON_PRICES.nail_trim;
//       nailCount++;
//     }
//     if (addons.includes("bath")) {
//       // Size (and price) is assigned later on /records — an unsized bath
//       // still counts, it just can't be priced yet.
//       if (d.bath_size) baths += BATH_PRICES[d.bath_size];
//       bathCount++;
//     }
//   }

//   for (const p of pickUps) {
//     if (p.service_type !== "daycare") continue;
//     const drop = dropOffs.find(
//       (d) =>
//         d.dog_id &&
//         d.dog_id === p.dog_id &&
//         d.service_type === "daycare",
//     );
//     const full =
//       drop && drop.created_at && p.created_at
//         ? isFullDayVisit(new Date(drop.created_at), new Date(p.created_at))
//         : true;

//     const hasPackage = packageUses.some(
//       (u) => u.dog_id && u.dog_id === p.dog_id,
//     );
//     // A package only covers the FULL-day rate. A half-day visit is always
//     // charged, package or not, per the rule in lib/pricing.ts.
//     if (hasPackage && full) continue;

//     if (full) {
//       daycareFull += PRICING.daycareFullDay;
//       daycareFullCount++;
//     } else {
//       daycareHalf += PRICING.daycareHalfDay;
//       daycareHalfCount++;
//     }

//     if (drop && drop.created_at && p.created_at) {
//       if (
//         isBaseCoveredByPackage(
//           hasPackage,
//           new Date(drop.created_at),
//           new Date(p.created_at),
//         )
//       )
//         continue;
//     }
//   }
  
//   // Every stay covering the day earns a night, plus its per-day add-ons.
//   let boardingNights = 0;
//   for (const b of boardings) {
//     boardingNights += PRICING.boardingPerNight;
//     const addons = b.addons ?? [];
//     if (addons.includes("walk")) {
//       const perDay = Math.max(1, b.walks_per_day ?? 1);
//       walks += perDay * BOARDING_ADDON_PRICES.walkPerWalk;
//       walkCount += perDay;
//     }
//     if (addons.includes("medication")) boardingNights += BOARDING_ADDON_PRICES.medicationPerDay;
//   }

//   const revenue: Category[] = [
//     { key: "daycare_full", label: "Daycare (full)", amount: daycareFull, count: daycareFullCount, color: "#4A72EF", service: "daycare" },
//     { key: "daycare_half", label: "Daycare (half)", amount: daycareHalf, count: daycareHalfCount, color: "#7C9AF5", service: "daycare" },
//     { key: "boarding", label: "Boarding nights", amount: boardingNights, count: boardings.length, color: "#0EA5E9", service: "boarding" },
//     { key: "walks", label: "Walks", amount: walks, count: walkCount, color: "#10B981" },
//     { key: "baths", label: "Baths", amount: baths, count: bathCount, color: "#F59E0B" },
//     { key: "nails", label: "Nail trims", amount: nails, count: nailCount, color: "#F97316" },
//   ];

//   const daycareDogs = dropOffs.filter((d) => d.service_type === "daycare").length;
//   const meetDogs = dropOffs.filter((d) => d.service_type === "meet_greet").length;
//   const dogsByService: Category[] = [
//     { key: "daycare", label: "Daycare", amount: daycareDogs, count: daycareDogs, color: "#4A72EF", service: "daycare" },
//     { key: "boarding", label: "Boarding", amount: boardings.length, count: boardings.length, color: "#0EA5E9", service: "boarding" },
//     { key: "meet", label: "Meet & greet", amount: meetDogs, count: meetDogs, color: "#A855F7", service: "meet_greet" },
//   ];

//   return {
//     revenue,
//     dogsByService,
//     revenueTotal: revenue.reduce((sum, c) => sum + c.amount, 0),
//     // What was actually taken at pick-up, as a cross-check on the split
//     // above — a hand-edited price shows up as a difference.
//     chargedTotal: pickUps.reduce((sum, p) => sum + (p.price ?? 0), 0),
//     dropOffs,
//     pickUps,
//     packageDaysUsed: packageUses.length,
//   };
// }

// The three queries every day-scoped view needs, in one place so the
// dashboard and the printable report can't drift on what "that day" means.
// `created_at` is a timestamp, so the day is bounded rather than matched;
// a boarding stay counts for any day its range covers.
export async function loadDailyData(dateKey: string): Promise<DailyInput> {
  const supabase = getSupabase();
  const fromIso = new Date(`${dateKey}T00:00:00`).toISOString();
  const toIso = new Date(`${dateKey}T23:59:59.999`).toISOString();

  const [signinRes, boardingRes, useRes, soldRes] = await Promise.all([
    supabase.from("signins").select("*").gte("created_at", fromIso).lte("created_at", toIso),
    supabase.from("boardings").select("*").lte("start_date", dateKey).gte("end_date", dateKey),
    supabase.from("package_uses").select("*").eq("used_on", dateKey),
    // Packages bought that day. This is where package money is recognized;
    // the days it buys are then spent at $0.
    supabase.from("packages").select("*").gte("created_at", fromIso).lte("created_at", toIso),
  ]);
  if (signinRes.error) throw signinRes.error;
  if (boardingRes.error) throw boardingRes.error;
  if (useRes.error) throw useRes.error;
  if (soldRes.error) throw soldRes.error;

  return {
    signins: (signinRes.data as SignInRecord[]) ?? [],
    boardings: (boardingRes.data as Boarding[]) ?? [],
    packageUses: (useRes.data as PackageUse[]) ?? [],
    packagesSold: (soldRes.data as Package[]) ?? [],
    // Carried through so the totals are computed against the day that was
    // actually loaded, not whatever "today" is in UTC when they run.
    selectedDate: dateKey,
  };
}
