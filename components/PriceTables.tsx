"use client";

import { PriceTable } from "@/components/PriceTable";
import { useSettings } from "@/components/SettingsProvider";
import { PackageTier } from "@/lib/settings";

// The public price list, built from the same settings the front desk bills
// with. Previously these were hand-typed figures on the marketing page,
// which is how a site ends up quoting a price the till does not charge.
//
// A client component so it follows a change made on /settings without a
// redeploy; the page around it stays a server component for its SEO
// metadata.

const money = (n: number) => `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;

function tierRows(tiers: PackageTier[], kind: "daycare" | "walk", unit: string) {
  return tiers
    // Tiers saved before walk packages existed have no kind, and are daycare.
    .filter((t) => (t.kind ?? "daycare") === kind)
    .sort((a, b) => a.days - b.days)
    .map((t) => ({ label: `${t.days}-${unit} package`, price: money(t.price) }));
}

export default function PriceTables() {
  const { settings } = useSettings();
  const p = settings.pricing;
  const tiers = settings.packageTiers;

  // Walk-in add-on prices are keyed by add-on so custom ones added on
  // /settings appear here too, rather than being invisible to clients.
  const walkPrice = p.addons.walk ?? 0;
  const nailTrimPrice = p.addons.nail_trim ?? p.boardingNailTrim;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <PriceTable
        title="Daycare"
        rows={[
          {
            label: `Half day (under ${p.daycareHalfDayThresholdHours} hours)`,
            price: money(p.daycareHalfDay),
          },
          { label: "Full day", price: money(p.daycareFullDay) },
          ...tierRows(tiers, "daycare", "day"),
          { label: "Late pickup (MAX 2 hours after closing)", price: `${money(p.latePickupFee)}/hr` },
        ]}
        note="Daycare packages have no expiration."
      />

      <PriceTable
        title="Boarding"
        rows={[
          {
            label: "Standard boarding (includes daycare)",
            price: `${money(p.boardingPerNight)}/night`,
          },
          {
            label: "Second dog, same address",
            price: `${money(p.boardingSecondDogPerNight)}/night`,
          },
          { label: "Daily walk add-on (~30 min)", price: money(p.boardingWalkPerWalk) },
          {
            label: `Daycare fee (after ${p.latePickupHour > 12 ? p.latePickupHour - 12 : p.latePickupHour} ${p.latePickupHour >= 12 ? "PM" : "AM"} on pick up day)`,
            price: money(p.latePickupFee),
          },
          {
            label: "Special needs add-on (medication, etc.)",
            price: money(p.boardingMedicationPerDay),
          },
        ]}
      />

      <PriceTable
        title="Bath & Grooming"
        rows={[
          { label: "Small dog", price: money(p.bath.S) },
          { label: "Medium dog", price: money(p.bath.M) },
          { label: "Large dog", price: money(p.bath.L) },
          { label: "Nail trim (any size)", price: money(nailTrimPrice) },
        ]}
      />

      <PriceTable
        title="Dog Walking"
        rows={[
          { label: "30-minute walk", price: money(walkPrice) },
          ...tierRows(tiers, "walk", "walk"),
        ]}
        note="Walking packages have no expiration."
      />
    </div>
  );
}
