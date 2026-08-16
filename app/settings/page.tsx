"use client";

import { ChangeEvent, useEffect, useState } from "react";
import Link from "next/link";
import { SiteImageError, deleteSiteImage, uploadSiteImage } from "@/lib/siteStorage";
import { renderTemplate, sendEmail } from "@/lib/email";
import {
  desktopAlertsOn,
  enableDesktopAlerts,
  setDesktopAlerts,
  showDesktopAlert,
} from "@/lib/notify";
import {
  AppSettings,
  CatalogItem,
  DEFAULT_SETTINGS,
  PackageTier,
  SettingsConflictError,
  saveSettings,
} from "@/lib/settings";
import { getSupabase } from "@/lib/supabase";
import { canRegisterWithSquare } from "@/lib/square";
import { useSettings } from "@/components/SettingsProvider";
import StaffGate from "@/components/StaffGate";
import useRole from "@/components/useRole";
import { isManagerOrAbove } from "@/lib/roles";
import StaffNav from "@/components/StaffNav";
import GalleryEditor from "@/components/GalleryEditor";
import { SinglePhotoEditor } from "@/components/SitePhotoEditors";
import ReportsSection from "@/components/ReportsSection";
import SecuritySection from "@/components/SecuritySection";
import ContentEditor from "@/components/ContentEditor";
import TerminalPairing from "@/components/TerminalPairing";

type Tab = "brand" | "pricing" | "website" | "content" | "messaging" | "reports" | "security";

// Thirteen sections on one page was a scroll, and the important ones (money)
// sat below a wall of photo uploaders. Grouped by what someone came here to
// change rather than by when each was built.
const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: "brand", label: "🎨 Brand", blurb: "Name, logo and colours" },
  { key: "pricing", label: "💵 Pricing", blurb: "Rates, add-ons and packages" },
  { key: "website", label: "🌐 Website", blurb: "Public site, contact details and photos" },
  { key: "content", label: "📝 Content", blurb: "The words on every public page" },
  { key: "messaging", label: "✉️ Messaging", blurb: "Client email and staff alerts" },
  { key: "reports", label: "📊 Reports", blurb: "Print, export and money owed" },
  { key: "security", label: "🔒 Security", blurb: "Sign-in, staff roles and activity" },
];

export default function SettingsPage() {
  return (
    <StaffGate title="App settings">
      <SettingsIfPermitted />
    </StaffGate>
  );
}

// Settings is manager and owner territory.
//
// Showing an employee the price table, letting them retype it, and only then
// refusing the save is the worst of both: it leaks what the business charges
// and wastes the time of somebody who was trying to help. If a thing cannot
// be changed by this account, it is not rendered.
//
// This is presentation only. The database refuses the write regardless — see
// the policy matrix in rls-lockdown.sql — and that is the boundary that
// actually holds. This just stops the app offering what it will not accept.
function SettingsIfPermitted() {
  const { account, loading, unavailable } = useRole();

  // A database that has not run the roles migration has no roles to read.
  // Locking the owner out of settings on the strength of a missing table
  // would be a worse failure than showing it.
  if (loading) return <p className="px-6 py-10 text-sm text-ink-3">Checking your account…</p>;
  if (!unavailable && !isManagerOrAbove(account?.role ?? null)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-3xl" aria-hidden>
          🔒
        </p>
        <h1 className="font-display mt-3 text-lg font-semibold text-ink">
          Settings needs a manager account
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-3">
          Prices, branding, staff and the website are changed by a manager or the owner. Ask
          whoever runs the daycare if something here needs to change.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600">
          Back to the dashboard
        </Link>
      </div>
    );
  }
  return <Settings />;
}

function Settings() {
  const [origin, setOrigin] = useState("");

  function setReview(index: number, patch: Partial<AppSettings["reviews"]["items"][number]>) {
    setDraft((d) => ({
      ...d,
      reviews: {
        ...d.reviews,
        items: d.reviews.items.map((r, i) => (i === index ? { ...r, ...patch } : r)),
      },
    }));
  }

  // Reordering matters: the first two are what most visitors read.
  function moveReview(index: number, delta: number) {
    setDraft((d) => {
      const items = [...d.reviews.items];
      const to = index + delta;
      if (to < 0 || to >= items.length) return d;
      [items[index], items[to]] = [items[to], items[index]];
      return { ...d, reviews: { ...d.reviews, items } };
    });
  }
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState("");

  // Simulated payments are real rows in the ledger — that is what makes the
  // test meaningful — so there has to be a way to take them back out.
  async function clearTestPayments() {
    if (!window.confirm("Remove every payment recorded in test mode? Real payments are untouched."))
      return;
    setClearing(true);
    setCleared("");
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("payments")
        .delete()
        .like("note", "TEST (no money taken)%")
        .select("id");
      if (err) throw err;
      const n = (data as { id: string }[] | null)?.length ?? 0;
      setCleared(`${n} removed`);
    } catch (e) {
      console.error("Clearing test payments failed:", e);
      setError("Could not remove the test payments.");
    } finally {
      setClearing(false);
    }
  }
  useEffect(() => setOrigin(window.location.origin), []);
  const { settings, refresh } = useSettings();
  // Edited as a local draft so a half-typed price never reaches the kiosk —
  // nothing takes effect until Save.
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [tab, setTab] = useState<Tab>("brand");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  function patchPricing(patch: Partial<AppSettings["pricing"]>) {
    setDraft((d) => ({ ...d, pricing: { ...d.pricing, ...patch } }));
  }

  function patchBusiness(patch: Partial<AppSettings["business"]>) {
    setDraft((d) => ({ ...d, business: { ...d.business, ...patch } }));
  }

  function patchEmail(patch: Partial<AppSettings["email"]>) {
    setDraft((d) => ({ ...d, email: { ...d.email, ...patch } }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await saveSettings(draft);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      console.error("Saving settings failed:", e);
      setError(
        e instanceof SettingsConflictError
          ? "Someone else changed settings since you opened this page — saving now would wipe their edit. Reload to pick up their changes, then redo yours."
          : "Could not save settings."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // Bigger than a dog photo — this one is rendered large on the kiosk.
      const url = await uploadSiteImage(file, "logo", 512, 100 * 1024);
      // The old file goes once the new one is safely uploaded.
      deleteSiteImage(draft.business.logoData);
      setDraft((d) => ({ ...d, business: { ...d.business, logoData: url } }));
    } catch (e) {
      console.error("Logo upload failed:", e);
      setError(
        e instanceof SiteImageError && e.kind === "upload"
          ? "Storage refused to save the logo. The image is fine — the database is missing its storage permissions. Run site-storage-migration.sql, then try again."
          : "Could not read that image — try a PNG or JPEG."
      );
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="/settings" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">
            Settings
          </h1>
          <p className="text-sm text-ink-3">
            Prices and add-ons here drive every estimate, sign-out total, and
            report.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs font-medium text-emerald-600">
              Saved ✓
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-xs font-medium text-rose-500">{error}</p>
      )}
      <div className="mb-6 border-b border-line">
        <div className="flex flex-wrap gap-2 pb-3">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              title={t.blurb}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? "bg-accent-500 text-accent-ink shadow-card"
                  : "border border-line bg-surface text-ink-2 hover:border-accent-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="pb-3 text-[11px] text-ink-3">
          {TABS.find((t) => t.key === tab)?.blurb}
        </p>
      </div>

      {/* Sticky, because this page is long enough that a banner at the top
          scrolls away exactly when it matters — and an unsaved edit here
          looks identical to a saved one. */}
      {dirty && (
        <div className="sticky top-3 z-40 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-card">
          <p className="text-xs font-medium text-amber-900">
            Unsaved changes — nothing takes effect until you save.
          </p>
          <button
            onClick={save}
            disabled={saving}
            className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save now"}
          </button>
        </div>
      )}

      {/* Branding */}
      {tab === "brand" && (
        <>
      <Section
        title="Business"
        blurb="Shown on the kiosk and at the top of printed reports.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name">
            <input
              value={draft.business.name}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  business: { ...draft.business, name: e.target.value },
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Tagline">
            <input
              value={draft.business.tagline}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  business: { ...draft.business, tagline: e.target.value },
                })
              }
              className={inputClass}
            />
          </Field>
        </div>

        {/* Colours */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Brand colour (buttons, links, highlights)">
            <ColorInput
              value={draft.business.accentColor}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  business: { ...draft.business, accentColor: v },
                })
              }
            />
          </Field>
          <Field label="Printed report colour (header, table rules)">
            <ColorInput
              value={draft.business.printColor}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  business: { ...draft.business, printColor: v },
                })
              }
            />
          </Field>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          Pick one colour each — the lighter and darker shades used across the
          app and on printed reports are derived from them. Changes preview live
          once saved.
        </p>

        <div className="mt-3 flex items-center gap-3">
          {draft.business.logoData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.business.logoData}
              alt="Logo"
              className="h-16 w-16 rounded-xl object-contain"
            />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-3 text-2xl">
              🐾
            </span>
          )}
          <div>
            <label className="cursor-pointer text-xs font-medium text-accent-600 hover:text-accent-800">
              {draft.business.logoData ? "Change logo" : "+ Upload a logo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogo}
              />
            </label>
            {draft.business.logoData && (
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    business: { ...draft.business, logoData: null },
                  })
                }
                className="ml-3 text-xs text-ink-3 hover:text-ink-2">
                Remove
              </button>
            )}
            <p className="mt-0.5 text-[11px] text-ink-3">
              Falls back to the bundled logo when empty.
            </p>
          </div>
        </div>
      </Section>

      {/* Daycare & boarding */}
        </>
      )}

      {tab === "pricing" && (
        <>
      <Section title="Daycare rates">
        <div className="grid gap-3 sm:grid-cols-3">
          <Money
            label="Full day"
            value={draft.pricing.daycareFullDay}
            onChange={(v) => patchPricing({ daycareFullDay: v })}
          />
          <Money
            label="Half day"
            value={draft.pricing.daycareHalfDay}
            onChange={(v) => patchPricing({ daycareHalfDay: v })}
          />
          <Field label="Half day is under (hours)">
            <input
              type="number"
              min={1}
              max={12}
              value={draft.pricing.daycareHalfDayThresholdHours}
              onChange={(e) =>
                patchPricing({
                  daycareHalfDayThresholdHours: Number(e.target.value) || 1,
                })
              }
              className={inputClass}
            />
          </Field>
          <Money
            label="Second dog — full day"
            value={draft.pricing.daycareSecondDogFullDay}
            onChange={(v) => patchPricing({ daycareSecondDogFullDay: v })}
          />
          <Money
            label="Second dog — half day"
            value={draft.pricing.daycareSecondDogHalfDay}
            onChange={(v) => patchPricing({ daycareSecondDogHalfDay: v })}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          A visit longer than the cutoff bills as a full day, and only a full day is covered by a
          package. The second-dog rates apply to every dog after the first from the same household
          on the same day — set them to 0 to charge every dog the full rate.
        </p>
      </Section>

      <Section title="Boarding rates">
        <div className="grid gap-3 sm:grid-cols-3">
          <Money
            label="Per night"
            value={draft.pricing.boardingPerNight}
            onChange={(v) => patchPricing({ boardingPerNight: v })}
          />
          <Money
            label="Second dog — per night"
            value={draft.pricing.boardingSecondDogPerNight}
            onChange={(v) => patchPricing({ boardingSecondDogPerNight: v })}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Charged per night, not per day: a Friday to Sunday stay is two nights. The second-dog
          rate applies to every dog after the first from the same household on the same dates.
        </p>
      </Section>

      <Section title="Early and late">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Early — before this hour (24h)">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.pricing.earlyHour}
              onChange={(e) => patchPricing({ earlyHour: Number(e.target.value) || 0 })}
              className={inputClass}
            />
          </Field>
          <Money
            label="Early fee"
            value={draft.pricing.earlyFee}
            onChange={(v) => patchPricing({ earlyFee: v })}
          />
          <Field label="Daycare — late after this hour (24h)">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.pricing.daycareLatePickupHour}
              onChange={(e) =>
                patchPricing({ daycareLatePickupHour: Number(e.target.value) || 0 })
              }
              className={inputClass}
            />
          </Field>
          <Money
            label="Daycare — late fee, per hour"
            value={draft.pricing.daycareLatePickupPerHour}
            onChange={(v) => patchPricing({ daycareLatePickupPerHour: v })}
          />
          <Field label="Boarding — late after this hour (24h)">
            <input
              type="number"
              min={0}
              max={23}
              value={draft.pricing.latePickupHour}
              onChange={(e) => patchPricing({ latePickupHour: Number(e.target.value) || 0 })}
              className={inputClass}
            />
          </Field>
          <Money
            label="Boarding — late fee, once"
            value={draft.pricing.latePickupFee}
            onChange={(v) => patchPricing({ latePickupFee: v })}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          <strong>Early</strong> is one fee, charged when a dog arrives or leaves before you open.
          <br />
          <strong>Late</strong> is two rules, because daycares charge them differently: daycare is
          per hour and rounded up, since the cost is somebody staying late; boarding is a flat fee,
          charged once on the day the dog actually goes home.
          <br />
          Any fee left at 0 is not charged. None of them are covered by a package — a package buys
          a day of daycare, not the time either side of it.
        </p>
      </Section>

      {/* Bath */}
      <Section
        title="Bath prices"
        blurb="Bath is priced by size, and the size comes from the dog's weight. Staff can still change it on a visit — a heavy-coated dog is more work than the scale suggests.">
        <div className="grid gap-3 sm:grid-cols-3">
          {(["S", "M", "L"] as const).map((size) => (
            <Money
              key={size}
              label={`Bath — ${size === "S" ? "small" : size === "M" ? "medium" : "large"}`}
              value={draft.pricing.bath[size]}
              onChange={(v) =>
                patchPricing({ bath: { ...draft.pricing.bath, [size]: v } })
              }
            />
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Small — up to (lb)">
            <input
              type="number"
              min={1}
              value={draft.pricing.bathWeightMax.S}
              onChange={(e) =>
                patchPricing({
                  bathWeightMax: {
                    ...draft.pricing.bathWeightMax,
                    S: Number(e.target.value) || 1,
                  },
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label="Medium — up to (lb)">
            <input
              type="number"
              min={1}
              value={draft.pricing.bathWeightMax.M}
              onChange={(e) =>
                patchPricing({
                  bathWeightMax: {
                    ...draft.pricing.bathWeightMax,
                    M: Number(e.target.value) || 1,
                  },
                })
              }
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          Up to {draft.pricing.bathWeightMax.S} lb is small, up to{" "}
          {draft.pricing.bathWeightMax.M} lb is medium, anything heavier is large. A dog with no
          weight on its profile gets no size, and staff are asked for one.
        </p>
      </Section>

      {/* Walk-in add-ons */}
      <Section
        title="Daycare add-ons"
        blurb="Offered at the kiosk on drop-off. Bath is priced above by size, so it has no flat price here.">
        <CatalogEditor
          items={draft.addons}
          prices={draft.pricing.addons}
          priceless={["bath"]}
          onChange={(items, prices) =>
            setDraft({
              ...draft,
              addons: items,
              pricing: { ...draft.pricing, addons: prices },
            })
          }
        />
      </Section>

      {/* Boarding add-ons */}
      <Section
        title="Package pricing"
        blurb="The blocks of daycare days you sell. Selling a package picks one of these, so the price list stays consistent and the discount is deliberate.">
        <PackageTierEditor
          tiers={draft.packageTiers}
          fullDay={draft.pricing.daycareFullDay}
          walkPrice={draft.pricing.addons.walk ?? 0}
          onChange={(packageTiers) => setDraft({ ...draft, packageTiers })}
        />
      </Section>
      <Section
        title="Boarding add-on rates"
        blurb="Booked per stay on the reservation.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Money
            label="Walk (per walk)"
            value={draft.pricing.boardingWalkPerWalk}
            onChange={(v) => patchPricing({ boardingWalkPerWalk: v })}
          />
          <Money
            label="Medication (per day)"
            value={draft.pricing.boardingMedicationPerDay}
            onChange={(v) => patchPricing({ boardingMedicationPerDay: v })}
          />
          <Money
            label="Nail trim (per stay)"
            value={draft.pricing.boardingNailTrim}
            onChange={(v) => patchPricing({ boardingNailTrim: v })}
          />
        </div>
      </Section>

      {/* Services */}
      <Section
        title="Services"
        blurb="The three shapes of visit. Rename them or change their icon to match what you call them — a business that says “Boarding” and one that says “Overnights” should both read right at the kiosk.">
        <CatalogEditor
          items={draft.services}
          onChange={(items) => setDraft({ ...draft, services: items })}
          allowAdd={false}
        />

        {/* Where a new chargeable thing actually goes.
            This section used to say only that a new service "needs a code
            change", which is true of these three and sends somebody away
            believing the app cannot take a new service at all. Most of what a
            daycare adds — grooming, a pick-up and drop-off run, a training
            session — is a flat fee on a visit, and that is an add-on, which
            takes a name and a price and no code at all. */}
        <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-ink-3">
          <strong className="text-ink-2">Adding something new to sell?</strong> Use{" "}
          <strong className="text-ink-2">add-ons</strong> above — give it a name and a price and it
          appears at the kiosk and on the bill straight away. Grooming, a pick-up and drop-off run,
          a training session: all add-ons.
          <br />
          <br />
          These three are different. They are not labels but rules — daycare is priced by hours on
          site and can be covered by a package, boarding is priced per night and needs a reservation,
          a meet &amp; greet is free and needs a verdict and a photo. A fourth one would have to
          answer both of those questions, so it needs building rather than naming.
        </div>
      </Section>

      {/* Email */}
      <Section
        title="Card payments (Square)"
        blurb="Take payment at pick-up through the Square app on your phone or tablet. Nothing here is secret — the Application ID travels in the link that opens Square.">
        <label className="mb-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.square.enabled}
            onChange={(e) =>
              setDraft({ ...draft, square: { ...draft.square, enabled: e.target.checked } })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Show a &ldquo;Pay now&rdquo; button at pick-up
            <span className="block text-[11px] text-ink-3">
              Only appears on a device that has the Square app installed.
            </span>
          </span>
        </label>

        {/* Which integration, decided by the hardware rather than taste.
            A Reader paired to a phone or tablet cannot be driven remotely —
            Square only pushes a cart to Terminal and Register — so a business
            with a Stand and a Reader has one option whatever it would prefer. */}
        {draft.square.enabled && (
          <div className="mb-4 rounded-xl border border-line bg-surface-2 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
              Your card hardware
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    key: "app" as const,
                    title: "Reader on a phone or tablet",
                    blurb:
                      "Tapping Pay now opens the Square app with the amount filled in, and comes back here when it is done.",
                  },
                  {
                    key: "terminal" as const,
                    title: "Square Terminal or Register",
                    blurb:
                      "The amount is sent straight to the device. Nobody leaves this screen. Needs a Square access token on the server.",
                  },
                ]
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, square: { ...draft.square, mode: option.key } })
                  }
                  className={`rounded-xl border p-3 text-left transition ${
                    draft.square.mode === option.key
                      ? "border-accent-500 bg-accent-50"
                      : "border-line bg-surface hover:border-accent-300"
                  }`}
                >
                  <span className="block text-sm font-medium text-ink">{option.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">
                    {option.blurb}
                  </span>
                </button>
              ))}
            </div>

            {draft.square.mode === "terminal" && (
              <div className="mt-3">
                <TerminalPairing
                  locationId={draft.square.locationId}
                  sandbox={draft.square.testMode}
                />
                <Field label="Paired terminal — device ID">
                  <input
                    value={draft.square.terminalDeviceId}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        square: { ...draft.square, terminalDeviceId: e.target.value.trim() },
                      })
                    }
                    placeholder="device:…"
                    className={inputClass}
                  />
                </Field>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  Once this is filled in, pick-up shows a <strong>Charge card</strong> button that
                  sends the amount straight to the Terminal. Nobody leaves this screen, and the
                  payment is recorded here when Square says it went through.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Square Application ID">
            <input
              value={draft.square.applicationId}
              onChange={(e) =>
                setDraft({ ...draft, square: { ...draft.square, applicationId: e.target.value.trim() } })
              }
              placeholder="sq0idp-…"
              className={inputClass}
            />
          </Field>
          <Field label="Location ID (optional)">
            <input
              value={draft.square.locationId}
              onChange={(e) =>
                setDraft({ ...draft, square: { ...draft.square, locationId: e.target.value.trim() } })
              }
              placeholder="Leave blank for the default location"
              className={inputClass}
            />
          </Field>
        </div>

        <label className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3">
          <input
            type="checkbox"
            checked={draft.square.testMode}
            onChange={(e) =>
              setDraft({ ...draft, square: { ...draft.square, testMode: e.target.checked } })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-amber-600 focus:ring-amber-200"
          />
          <span className="text-sm text-ink-2">
            🧪 Test mode — simulate payments without Square
            <span className="block text-[11px] text-ink-3">
              The button becomes &ldquo;Simulate payment&rdquo; and skips the Square app entirely.
              Everything else runs for real, so you can watch a balance clear on a laptop before you
              have the hardware or a live domain. No card is ever charged.
            </span>
          </span>
        </label>

        {settings.square.testMode && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-100 px-4 py-2.5">
            <p className="text-xs font-medium text-amber-900">
              Test mode is on — payments recorded now are not real.
            </p>
            <button
              onClick={clearTestPayments}
              disabled={clearing}
              className="ml-auto rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-60"
            >
              {clearing ? "Removing…" : "Remove test payments"}
            </button>
            {cleared && <span className="text-xs font-medium text-emerald-700">{cleared}</span>}
          </div>
        )}

        <div className="mt-4 rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-ink-2">
          <p className="mb-1.5 font-semibold text-ink">Setting this up</p>
          <ol className="list-inside list-decimal space-y-1">
            <li>
              At <code>developer.squareup.com</code>, create an application. Copy its{" "}
              <strong>Application ID</strong> into the box above.
            </li>
            <li>
              In that application, open <strong>Point of Sale API</strong> and add this exact web
              callback URL:
              <code className="mt-1 block break-all rounded-lg bg-surface px-2 py-1.5">
                {origin ? `${origin}/pay/return` : "https://yourdomain.com/pay/return"}
              </code>
              {/* Square rejects anything that is not a public HTTPS address, and
                  the failure surfaces inside the Square app as "not configured
                  for making web calls" — which reads like a portal problem
                  rather than a wrong address. Say so before they go looking. */}
              {origin && !canRegisterWithSquare(origin) && (
                <span className="mt-1.5 block rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">
                  ⚠️ Square will not accept that address. It only takes a public{" "}
                  <strong>https://</strong> domain — not <code>localhost</code>, not an IP address on
                  your wifi. Real card payments therefore only work from the deployed site; use test
                  mode until then.
                </span>
              )}
            </li>
            <li>Install the Square app on the tablet and sign in to the business account.</li>
            <li>Pair the Square Reader to that device in the Square app.</li>
          </ol>
          <p className="mt-2 text-ink-3">
            Payments land in your Square account as normal. This app records them against the
            household so the balance clears — it never touches card details.
          </p>
        </div>
      </Section>

        </>
      )}

      {tab === "website" && (
        <>
      <Section
        title="Public website"
        blurb="This deployment can be your whole web presence, or just the back office behind a website you already have.">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.site.enabled}
            onChange={(e) =>
              setDraft({
                ...draft,
                site: { ...draft.site, enabled: e.target.checked },
              })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Serve the built-in marketing website
            <span className="block text-[11px] text-ink-3">
              Home, Daycare, Boarding, Bath, Dog Walking, Prices, Gallery, About
              and Contact. Turn this off if you already have a website you want
              to keep.
            </span>
          </span>
        </label>

        {!draft.site.enabled && (
          <div className="mt-3">
            <Field label="Your website address">
              <input
                value={draft.site.externalUrl}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    site: { ...draft.site, externalUrl: e.target.value },
                  })
                }
                placeholder="https://www.yourdaycare.com"
                className={inputClass}
              />
            </Field>
            <p className="mt-1.5 text-[11px] text-ink-3">
              Anyone landing on this app&apos;s home page is sent here. Leave
              blank to send them to the kiosk instead.
            </p>
          </div>
        )}

        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-[11px] text-ink-3">
          The enrollment and boarding forms stay available either way — they are
          what an existing website links to or embeds. Their links are under{" "}
          <strong>Online forms</strong> below. The kiosk is always at{" "}
          <code className="rounded bg-surface-3 px-1">/kiosk</code>, and the
          staff pages are unaffected.
        </p>
      </Section>

      <Section
        title="Client accounts"
        blurb="A sign-in where clients see their own dogs, packages, stays and invoices, keep their details up to date, and ask for boarding dates. Requests still come to the queue — nothing books itself.">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.portal.enabled}
            onChange={(e) =>
              setDraft({
                ...draft,
                portal: { ...draft.portal, enabled: e.target.checked },
              })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Let clients sign in to their own account
            <span className="block text-[11px] text-ink-3">
              Off until you are ready. A daycare that has not opened has no clients, and a sign-in
              page for accounts nobody holds is a phone call to the front desk.
            </span>
          </span>
        </label>

        <p className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-[11px] leading-relaxed text-ink-3">
          {draft.portal.enabled ? (
            <>
              Clients cannot sign themselves up. A member of staff invites a household from its
              owner profile, and the link goes to the address on file — which is what makes holding
              it proof of who they are.
            </>
          ) : (
            <>
              While this is off the sign-in page does not exist — anybody typing the address is sent
              back to the home page — and no invitation button appears on an owner profile. Turning
              it on later changes nothing about the records you already have.
            </>
          )}
        </p>
      </Section>

      <Section
        title="Staff"
        blurb="Who appears in the walk log dropdown, and the times it offers. Keeping this a list rather than a free-text box is what stops one person being logged as RM, R. Marsh and Rob.">
        <div className="space-y-2">
          {draft.staff.names.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={n}
                onChange={(e) => {
                  const names = [...draft.staff.names];
                  names[i] = e.target.value;
                  setDraft({ ...draft, staff: { ...draft.staff, names } });
                }}
                placeholder="Name or initials"
                className={inputClass}
              />
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    staff: { ...draft.staff, names: draft.staff.names.filter((_, x) => x !== i) },
                  })
                }
                className="shrink-0 rounded-lg border border-line px-2.5 py-2 text-xs text-ink-3 hover:border-rose-300 hover:text-rose-500"
              >
                ✕
              </button>
            </div>
          ))}
          {draft.staff.names.length === 0 && (
            <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
              No staff added yet, so the walk log&apos;s &ldquo;by&rdquo; dropdown is empty. Anything
              already logged still shows.
            </p>
          )}
        </div>
        <button
          onClick={() =>
            setDraft({ ...draft, staff: { ...draft.staff, names: [...draft.staff.names, ""] } })
          }
          className="mt-2 rounded-xl border border-dashed border-line px-4 py-2 text-xs font-medium text-ink-3 hover:border-accent-400 hover:text-accent-600"
        >
          + Add a staff member
        </button>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Walk times from">
            <select
              value={draft.staff.walkDayStartHour}
              onChange={(e) =>
                setDraft({ ...draft, staff: { ...draft.staff, walkDayStartHour: Number(e.target.value) } })
              }
              className={inputClass}
            >
              {Array.from({ length: 13 }, (_, i) => i + 4).map((h) => (
                <option key={h} value={h}>
                  {h % 12 === 0 ? 12 : h % 12}:00 {h < 12 ? "am" : "pm"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Walk times until">
            <select
              value={draft.staff.walkDayEndHour}
              onChange={(e) =>
                setDraft({ ...draft, staff: { ...draft.staff, walkDayEndHour: Number(e.target.value) } })
              }
              className={inputClass}
            >
              {Array.from({ length: 13 }, (_, i) => i + 12).map((h) => (
                <option key={h} value={h}>
                  {h % 12 === 0 ? 12 : h % 12}:00 {h < 12 ? "am" : "pm"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="In steps of">
            <select
              value={draft.staff.walkStepMinutes}
              onChange={(e) =>
                setDraft({ ...draft, staff: { ...draft.staff, walkStepMinutes: Number(e.target.value) } })
              }
              className={inputClass}
            >
              {[15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>

      {/* Website photos */}
      <Section
        title="Contact & hours"
        blurb="Shown on the website header, footer and contact page, and in the business listing search engines read. Changing anything here updates the site immediately — no redeploy.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <input
              value={draft.business.phone}
              onChange={(e) => patchBusiness({ phone: e.target.value })}
              placeholder="(415) 555-0132"
              className={inputClass}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={draft.business.email}
              onChange={(e) => patchBusiness({ email: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street address">
              <input
                value={draft.business.street}
                onChange={(e) => patchBusiness({ street: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              value={draft.business.city}
              onChange={(e) => patchBusiness({ city: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input
                value={draft.business.state}
                onChange={(e) =>
                  patchBusiness({ state: e.target.value.toUpperCase() })
                }
                maxLength={2}
                className={inputClass}
              />
            </Field>
            <Field label="ZIP">
              <input
                value={draft.business.zip}
                onChange={(e) => patchBusiness({ zip: e.target.value })}
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Hours
        </p>
        <div className="mt-1 grid gap-3">
          <Field label="Weekdays">
            <input
              value={draft.business.hoursWeekday}
              onChange={(e) => patchBusiness({ hoursWeekday: e.target.value })}
              placeholder="Monday – Friday, 7:00 AM – 7:00 PM"
              className={inputClass}
            />
          </Field>
          <Field label="Weekend">
            <input
              value={draft.business.hoursWeekend}
              onChange={(e) => patchBusiness({ hoursWeekend: e.target.value })}
              placeholder="Saturday – Sunday, 9:00 AM – 5:00 PM"
              className={inputClass}
            />
          </Field>
          <Field label="Boarding">
            <input
              value={draft.business.hoursBoarding}
              onChange={(e) => patchBusiness({ hoursBoarding: e.target.value })}
              placeholder="Overnight care, 7 days a week"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Instagram URL">
            <input
              value={draft.business.instagram}
              onChange={(e) => patchBusiness({ instagram: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Instagram handle">
            <input
              value={draft.business.instagramHandle}
              onChange={(e) =>
                patchBusiness({ instagramHandle: e.target.value })
              }
              placeholder="@yourhandle"
              className={inputClass}
            />
          </Field>
          <Field label="Website address">
            <input
              value={draft.business.domain}
              onChange={(e) => patchBusiness({ domain: e.target.value })}
              placeholder="https://www.example.com"
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">
          The website address is the canonical URL search engines are pointed
          at. It must start with https:// — an invalid value is ignored rather
          than breaking the site.
        </p>
      </Section>

      {/* Notifications */}
      <Section
        title="Website photos"
        blurb="Every image on the public site. Stored separately from these settings, so a page full of photos never gets loaded by the kiosk. Each one saves as you change it — the Save button above does not apply here."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <SinglePhotoEditor
            kind="hero"
            label="Home page hero"
            hint="The large photo beside the headline on the front page."
          />
          <SinglePhotoEditor
            kind="about"
            label="About Us hero"
            hint="The photo beside the intro on the About Us page."
          />
        </div>

        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Gallery
        </p>
        <div className="mt-1">
          <GalleryEditor />
        </div>
      </Section>

      {/* Reviews — shown on the home page and the reviews section */}
      <Section
        title="Reviews"
        blurb="Quotes shown on the website. Copy them from your real listing — do not write new ones.">
        <label className="mb-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.reviews.enabled}
            onChange={(e) =>
              setDraft({ ...draft, reviews: { ...draft.reviews, enabled: e.target.checked } })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Show reviews on the website
            <span className="block text-[11px] text-ink-3">
              Turn this off, or delete them all, and the reviews section disappears entirely.
            </span>
          </span>
        </label>

        <div className="mb-3 max-w-xs">
          <Field label="Where they came from">
            <input
              value={draft.reviews.source}
              onChange={(e) =>
                setDraft({ ...draft, reviews: { ...draft.reviews, source: e.target.value } })
              }
              placeholder="Yelp"
              className={inputClass}
            />
            <p className="mt-1 text-[11px] text-ink-3">
              Shown as &ldquo;based on 4 Yelp reviews&rdquo;.
            </p>
          </Field>
        </div>

        <div className="space-y-3">
          {draft.reviews.items.map((review, i) => (
            <div key={i} className="rounded-2xl border border-line-soft bg-surface-2 p-3.5">
              <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
                <Field label="Name">
                  <input
                    value={review.name}
                    onChange={(e) => setReview(i, { name: e.target.value })}
                    placeholder="Rowena W."
                    className={inputClass}
                  />
                </Field>
                <Field label="When">
                  <input
                    value={review.date}
                    onChange={(e) => setReview(i, { date: e.target.value })}
                    placeholder="October 2025"
                    className={inputClass}
                  />
                </Field>
                <Field label="Stars">
                  <select
                    value={review.rating}
                    onChange={(e) => setReview(i, { rating: Number(e.target.value) })}
                    className={inputClass}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {"★".repeat(n)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-2">
                <Field label="Quote">
                  <textarea
                    value={review.quote}
                    onChange={(e) => setReview(i, { quote: e.target.value })}
                    rows={2}
                    className={`${inputClass} leading-relaxed`}
                  />
                </Field>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => moveReview(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  className="rounded-lg border border-line px-2 py-1 text-xs text-ink-3 transition hover:border-accent-300 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveReview(i, 1)}
                  disabled={i === draft.reviews.items.length - 1}
                  title="Move down"
                  className="rounded-lg border border-line px-2 py-1 text-xs text-ink-3 transition hover:border-accent-300 disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      reviews: {
                        ...draft.reviews,
                        items: draft.reviews.items.filter((_, x) => x !== i),
                      },
                    })
                  }
                  className="ml-auto rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-500 transition hover:border-rose-300"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() =>
            setDraft({
              ...draft,
              reviews: {
                ...draft.reviews,
                items: [
                  ...draft.reviews.items,
                  { name: "", date: "", rating: 5, quote: "" },
                ],
              },
            })
          }
          className="mt-3 w-full rounded-xl border border-dashed border-line px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-400 hover:text-accent-600"
        >
          + Add a review
        </button>

        <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] leading-relaxed text-amber-900">
          ⚠️ Only publish reviews people actually left you. Copy them from your Google or Yelp
          listing word for word. Writing your own is against those platforms&apos; terms and, in the
          US, against FTC rules on endorsements.
        </p>
      </Section>

      {/* Contact details — shown across the public website */}
      <Section
        title="Online forms"
        blurb="The links clients use. Send them directly, or embed them on your own website.">
        <OnlineForms />
      </Section>

      {/* Public website on/off */}
        </>
      )}

      {tab === "messaging" && (
        <>
      <Section
        title="Email"
        blurb="Messages to clients about their enrollment. Sending needs RESEND_API_KEY in .env.local and a From address on your verified domain — leave it unset and the app simply doesn't email anyone.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="From name">
            <input
              value={draft.email.fromName}
              onChange={(e) => patchEmail({ fromName: e.target.value })}
              placeholder={draft.business.name}
              className={inputClass}
            />
          </Field>
          <Field label="From address">
            <input
              value={draft.email.fromAddress}
              onChange={(e) => patchEmail({ fromAddress: e.target.value })}
              placeholder="hello@yourdomain.com"
              className={inputClass}
            />
          </Field>
          <Field label="Reply-to (optional)">
            <input
              value={draft.email.replyTo}
              onChange={(e) => patchEmail({ replyTo: e.target.value })}
              placeholder="frontdesk@yourdomain.com"
              className={inputClass}
            />
          </Field>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
          Templates can use{" "}
          <code className="rounded bg-surface-3 px-1">{"{{owner}}"}</code>,{" "}
          <code className="rounded bg-surface-3 px-1">{"{{dogs}}"}</code>,{" "}
          <code className="rounded bg-surface-3 px-1">{"{{business}}"}</code>{" "}
          and <code className="rounded bg-surface-3 px-1">{"{{phone}}"}</code>.
          <br />
          <code className="rounded bg-surface-3 px-1">{"{{meetgreet}}"}</code> is the day and
          arrival window the household asked for — “Mon, Aug 24, 8:00–10:30 am”. Picking a date is
          optional on the form, so when they did not it reads “a time we still need to arrange”
          instead. Both are written to sit in the same sentence, so there is only one version to
          get right.
        </p>

        {/* The sandbox sender only delivers to the address on the Resend
            account, so an automatic acknowledgement to a real client fails
            silently — the client never hears back and nothing on screen
            says so, since submission deliberately survives a failed email. */}
        {draft.email.autoAcknowledge &&
          /resend\.dev\s*$/i.test(draft.email.fromAddress.trim()) && (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
              ⚠️ You are sending from Resend&apos;s sandbox address, which only
              delivers to your own Resend account. Automatic acknowledgements to
              real clients will not arrive. Fine for testing — turn this off, or
              verify a domain, before going live.
            </p>
          )}

        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.email.autoAcknowledge}
            onChange={(e) => patchEmail({ autoAcknowledge: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Email an acknowledgement automatically when a form is submitted
            <span className="block text-[11px] text-ink-3">
              Sent straight away, with no staff involvement. The approve and
              decline messages below are always written by hand before sending.
            </span>
          </span>
        </label>

        <EmailTemplate
          label="Automatic acknowledgement"
          subject={draft.email.ackSubject}
          body={draft.email.ackBody}
          onSubject={(v) => patchEmail({ ackSubject: v })}
          onBody={(v) => patchEmail({ ackBody: v })}
        />
        <EmailTemplate
          label="After approving"
          subject={draft.email.approvedSubject}
          body={draft.email.approvedBody}
          onSubject={(v) => patchEmail({ approvedSubject: v })}
          onBody={(v) => patchEmail({ approvedBody: v })}
        />
        <EmailTemplate
          label="After declining"
          subject={draft.email.declinedSubject}
          body={draft.email.declinedBody}
          onSubject={(v) => patchEmail({ declinedSubject: v })}
          onBody={(v) => patchEmail({ declinedBody: v })}
        />
        <EmailTemplate
          label="Details form, after a meet & greet passes"
          subject={draft.email.detailsRequestSubject}
          body={draft.email.detailsRequestBody}
          onSubject={(v) => patchEmail({ detailsRequestSubject: v })}
          onBody={(v) => patchEmail({ detailsRequestBody: v })}
        />
        <p className="mt-1 text-[11px] text-ink-3">
          Sent automatically the moment staff record a meet &amp; greet as passed. It must
          contain <code className="rounded bg-surface-3 px-1">{"{{link}}"}</code> — that is
          the household&apos;s own link to the second half of the enrollment form, and
          without it there is nothing for them to fill in.
        </p>
        {!draft.email.detailsRequestBody.includes("{{link}}") && (
          <p className="mt-2 rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
            ⚠️ This message has no {"{{link}}"} in it, so nobody who receives it can
            complete their details.
          </p>
        )}

        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Boarding requests
        </p>
        <p className="mb-1 text-[11px] text-ink-3">
          These can also use{" "}
          <code className="rounded bg-surface-3 px-1">{"{{dropoff}}"}</code>,{" "}
          <code className="rounded bg-surface-3 px-1">{"{{pickup}}"}</code> and{" "}
          <code className="rounded bg-surface-3 px-1">{"{{nights}}"}</code>.
        </p>

        <EmailTemplate
          label="Automatic acknowledgement"
          subject={draft.email.boardingAckSubject}
          body={draft.email.boardingAckBody}
          onSubject={(v) => patchEmail({ boardingAckSubject: v })}
          onBody={(v) => patchEmail({ boardingAckBody: v })}
        />
        <EmailTemplate
          label="After confirming"
          subject={draft.email.boardingConfirmedSubject}
          body={draft.email.boardingConfirmedBody}
          onSubject={(v) => patchEmail({ boardingConfirmedSubject: v })}
          onBody={(v) => patchEmail({ boardingConfirmedBody: v })}
        />
        <EmailTemplate
          label="After declining"
          subject={draft.email.boardingDeclinedSubject}
          body={draft.email.boardingDeclinedBody}
          onSubject={(v) => patchEmail({ boardingDeclinedSubject: v })}
          onBody={(v) => patchEmail({ boardingDeclinedBody: v })}
        />

        <EmailPreview email={draft.email} businessName={draft.business.name} />
      </Section>

      {/* Public forms */}
      <Section
        title="Notifications"
        blurb="How staff find out a client sent something in. Separate from the client-facing email above.">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.email.notifyOnNewRequest}
            onChange={(e) =>
              patchEmail({ notifyOnNewRequest: e.target.checked })
            }
            className="mt-0.5 h-4 w-4 rounded border-line text-accent-500 focus:ring-accent-100"
          />
          <span className="text-sm text-ink-2">
            Email staff when a new request arrives
            <span className="block text-[11px] text-ink-3">
              Covers both new-client enrollments and boarding requests.
            </span>
          </span>
        </label>

        <div className="mt-3">
          <Field label="Send staff notifications to">
            <input
              value={draft.email.notifyAddresses}
              onChange={(e) => patchEmail({ notifyAddresses: e.target.value })}
              placeholder="frontdesk@yourdomain.com, manager@yourdomain.com"
              className={inputClass}
            />
          </Field>
          <p className="mt-1 text-[11px] text-ink-3">
            Separate several with commas. Leave blank and no staff email is sent
            — the in-app badge and alerts below still work.
          </p>
        </div>

        <DesktopAlerts />
      </Section>
        </>
      )}

      {tab === "content" && <ContentEditor draft={draft} setDraft={setDraft} />}

      {tab === "reports" && <ReportsSection />}

      {tab === "security" && <SecuritySection />}

      {/* Nothing on the Reports or Security tabs is a setting on this page,
          so the save bar would only invite a pointless click there. Roles and
          two-factor changes save themselves the moment they are made. */}
      {tab !== "reports" && tab !== "security" && (
      <div className="mb-10 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                "Reset every setting back to the shipped defaults?",
              )
            ) {
              setDraft(DEFAULT_SETTINGS);
            }
          }}
          className="text-xs font-medium text-ink-3 hover:text-ink-2">
          Reset to defaults
        </button>
      </div>
      )}
    </div>
  );
}

// Add, rename, re-icon, reprice, and remove catalog entries. Built-ins can
// be edited but not deleted — code paths depend on their keys existing.
function CatalogEditor({
  items,
  prices,
  priceless = [],
  onChange,
  allowAdd = true,
}: {
  items: CatalogItem[];
  prices?: Record<string, number>;
  priceless?: string[];
  onChange: (items: CatalogItem[], prices: Record<string, number>) => void;
  allowAdd?: boolean;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [newIcon, setNewIcon] = useState("✨");
  const [newPrice, setNewPrice] = useState("");

  function update(next: CatalogItem[], nextPrices?: Record<string, number>) {
    onChange(next, nextPrices ?? prices ?? {});
  }

  function add() {
    const label = newLabel.trim();
    if (!label) return;
    // Derive a stable key from the label — it's what gets written into
    // signins.addons, so it must not change when the label is edited later.
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || items.some((i) => i.key === key)) return;
    update(
      [...items, { key, label, icon: newIcon.trim() || "✨" }],
      { ...(prices ?? {}), [key]: parseFloat(newPrice) || 0 }
    );
    setNewLabel("");
    setNewIcon("✨");
    setNewPrice("");
  }

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={item.key} className="flex flex-wrap items-center gap-2">
          <input
            value={item.icon}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, icon: e.target.value };
              update(next);
            }}
            className="w-14 rounded-xl border border-line bg-surface-2 px-2 py-2 text-center text-sm outline-none focus:border-accent-500"
          />
          <input
            value={item.label}
            onChange={(e) => {
              const next = [...items];
              next[i] = { ...item, label: e.target.value };
              update(next);
            }}
            className="min-w-[8rem] flex-1 rounded-xl border border-line bg-surface-2 px-3.5 py-2 text-sm outline-none focus:border-accent-500"
          />
          {prices && !priceless.includes(item.key) && (
            <div className="flex items-center gap-1">
              <span className="text-sm text-ink-3">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={prices[item.key] ?? 0}
                onChange={(e) =>
                  update(items, { ...prices, [item.key]: parseFloat(e.target.value) || 0 })
                }
                className="w-24 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-500"
              />
            </div>
          )}
          {prices && priceless.includes(item.key) && (
            <span className="text-[11px] text-ink-3">priced by size above</span>
          )}
          {item.builtin ? (
            <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-ink-3">
              built in
            </span>
          ) : (
            <button
              onClick={() => update(items.filter((x) => x.key !== item.key))}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {allowAdd && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <input
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            className="w-14 rounded-xl border border-line bg-surface px-2 py-2 text-center text-sm outline-none focus:border-accent-500"
          />
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New add-on name"
            className="min-w-[10rem] flex-1 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none focus:border-accent-500"
          />
          <div className="flex items-center gap-1">
            <span className="text-sm text-ink-3">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="0.00"
              className="w-24 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
          </div>
          <button
            onClick={add}
            disabled={!newLabel.trim()}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 hover:border-accent-300 disabled:opacity-50"
          >
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

// The blocks of days the business sells. Each row shows its effective
// per-day rate against the walk-in price, so it's obvious at a glance
// whether a tier is actually a discount.
function PackageTierEditor({
  tiers,
  fullDay,
  walkPrice,
  onChange,
}: {
  tiers: PackageTier[];
  fullDay: number;
  walkPrice: number;
  onChange: (tiers: PackageTier[]) => void;
}) {
  const [newKind, setNewKind] = useState<"daycare" | "walk">("daycare");
  const [newDays, setNewDays] = useState("");
  const [newPrice, setNewPrice] = useState("");

  function add() {
    const days = parseInt(newDays);
    const price = parseFloat(newPrice);
    if (!days || days < 1 || Number.isNaN(price)) return;
    // One tier per (kind, count) — 10 daycare days and 10 walks coexist.
    if (tiers.some((t) => t.days === days && (t.kind ?? "daycare") === newKind)) return;
    onChange(
      [...tiers, { kind: newKind, days, price }].sort(
        (a, b) => (a.kind ?? "daycare").localeCompare(b.kind ?? "daycare") || a.days - b.days
      )
    );
    setNewDays("");
    setNewPrice("");
  }

  return (
    <div className="space-y-2">
      {tiers.map((tier, i) => {
        const perDay = tier.days > 0 ? tier.price / tier.days : 0;
        // Compare against whatever a single one costs walk-in: a daycare day
        // or a walk, depending on the tier.
        const walkIn = (tier.kind ?? "daycare") === "walk" ? walkPrice : fullDay;
        const saves = walkIn - perDay;
        return (
          <div key={`${tier.kind ?? "daycare"}-${tier.days}`} className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              value={tier.days}
              onChange={(e) => {
                const next = [...tiers];
                next[i] = { ...tier, days: Math.max(1, parseInt(e.target.value) || 1) };
                onChange(next);
              }}
              className="w-20 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-500"
            />
            <select
              value={tier.kind ?? "daycare"}
              onChange={(e) => {
                const next = [...tiers];
                next[i] = { ...tier, kind: e.target.value as "daycare" | "walk" };
                onChange(next);
              }}
              className="rounded-xl border border-line bg-surface-2 px-2 py-2 text-sm outline-none focus:border-accent-500"
            >
              <option value="daycare">daycare days</option>
              <option value="walk">walks</option>
            </select>
            <span className="text-sm text-ink-3">for</span>
            <div className="flex items-center gap-1">
              <span className="text-sm text-ink-3">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={tier.price}
                onChange={(e) => {
                  const next = [...tiers];
                  next[i] = { ...tier, price: parseFloat(e.target.value) || 0 };
                  onChange(next);
                }}
                className="w-28 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent-500"
              />
            </div>
            <span className="text-[11px] text-ink-3">
              ${perDay.toFixed(2)}/day
              {saves > 0 ? (
                <span className="ml-1 font-medium text-emerald-600">
                  saves ${saves.toFixed(2)} each
                </span>
              ) : (
                // Worth flagging — a tier priced at or above the walk-in rate
                // gives the client no reason to buy it.
                <span className="ml-1 font-medium text-amber-600">no saving vs walk-in</span>
              )}
            </span>
            <button
              onClick={() => onChange(tiers.filter((t) => t.days !== tier.days))}
              className="rounded-lg border border-rose-200 px-2.5 py-1 text-[11px] text-rose-500 hover:border-rose-300"
            >
              Remove
            </button>
          </div>
        );
      })}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
        <input
          type="number"
          min={1}
          value={newDays}
          onChange={(e) => setNewDays(e.target.value)}
          placeholder="10"
          className="w-20 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent-500"
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as "daycare" | "walk")}
          className="rounded-xl border border-line bg-surface px-2 py-2 text-sm outline-none focus:border-accent-500"
        >
          <option value="daycare">daycare days</option>
          <option value="walk">walks</option>
        </select>
        <span className="text-sm text-ink-3">for</span>
        <div className="flex items-center gap-1">
          <span className="text-sm text-ink-3">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="600.00"
            className="w-28 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent-500"
          />
        </div>
        <button
          onClick={add}
          disabled={!newDays || !newPrice}
          className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 hover:border-accent-300 disabled:opacity-50"
        >
          + Add tier
        </button>
      </div>
      {tiers.length === 0 && (
        <p className="text-[11px] text-amber-700">
          No tiers configured — staff will have to enter a price by hand on every sale.
        </p>
      )}
    </div>
  );
}

// A colour swatch plus the hex, so it can be picked or pasted from a brand
// guide. Invalid text is simply not committed rather than blanking the theme.
function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 cursor-pointer rounded-xl border border-line bg-surface p-1"
      />
      <input
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
            onChange(v.startsWith("#") ? v : `#${v}`);
          }
        }}
        className="w-28 rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-sm outline-none focus:border-accent-500"
      />
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <span className="text-sm text-ink-3">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={inputClass}
        />
      </div>
    </Field>
  );
}

// Desktop alerts are a per-DEVICE choice, not a business setting: the
// browser owns the permission, and the front-desk iPad wanting them says
// nothing about the manager's laptop. So this lives in localStorage rather
// than in the settings row.
function DesktopAlerts() {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "blocked">("off");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setState("unsupported");
    } else if (Notification.permission === "denied") {
      setState("blocked");
    } else {
      setState(desktopAlertsOn() ? "on" : "off");
    }
  }, []);

  async function turnOn() {
    const ok = await enableDesktopAlerts();
    if (!ok) {
      setState(Notification.permission === "denied" ? "blocked" : "off");
      return;
    }
    setState("on");
    showDesktopAlert("Alerts are on", "You'll see new requests here as they arrive.");
  }

  return (
    <div className="mt-4 rounded-xl border border-line-soft p-3.5">
      <p className="text-sm font-medium text-ink-2">Desktop alerts on this device</p>
      <p className="mt-0.5 text-[11px] text-ink-3">
        Pops up a notification while a staff page is open, checked once a minute. Set separately on
        every device — the browser owns the permission.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state === "unsupported" && (
          <span className="text-xs text-ink-3">This browser doesn&apos;t support notifications.</span>
        )}
        {state === "blocked" && (
          <span className="text-xs text-rose-500">
            Blocked in the browser — allow notifications for this site in its address-bar settings,
            then reload.
          </span>
        )}
        {state === "off" && (
          <button
            onClick={turnOn}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-2 transition hover:border-accent-300"
          >
            Turn on
          </button>
        )}
        {state === "on" && (
          <>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              On for this device
            </span>
            <button
              onClick={() => {
                setDesktopAlerts(false);
                setState("off");
              }}
              className="text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              Turn off
            </button>
            <button
              onClick={() => showDesktopAlert("Test alert", "This is what a new request looks like.")}
              className="text-xs font-medium text-accent-600 hover:underline"
            >
              Show a test
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Stand-in answers, so a template can be previewed before any real client
// has ever submitted one.
const SAMPLE = {
  owner: "Alex",
  dogs: "Buki and Mochi",
  phone: "(415) 555-0132",
  dropoff: "Fri, Aug 14",
  pickup: "Mon, Aug 17",
  nights: "3",
  link: "https://example.com/enroll/details/8f14e45f-ceea-467a-9f77-2c3b0a1d5e42",
};

type PreviewKey =
  | "ack"
  | "approved"
  | "declined"
  | "details"
  | "back"
  | "bconfirmed"
  | "bdeclined";

const PREVIEW_TABS: { key: PreviewKey; label: string }[] = [
  { key: "ack", label: "Enroll · ack" },
  { key: "approved", label: "Enroll · approved" },
  { key: "declined", label: "Enroll · declined" },
  { key: "details", label: "Enroll · details form" },
  { key: "back", label: "Boarding · ack" },
  { key: "bconfirmed", label: "Boarding · confirmed" },
  { key: "bdeclined", label: "Boarding · declined" },
];

// Shows what a template actually turns into, and sends it somewhere real.
// Reads the DRAFT rather than saved settings, so wording can be checked
// before committing it — including the From address, which is the setting
// most likely to be wrong on a first run.
function EmailPreview({
  email,
  businessName,
}: {
  email: AppSettings["email"];
  businessName: string;
}) {
  const [tab, setTab] = useState<PreviewKey>("ack");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const vars = { ...SAMPLE, business: businessName };
  const BY_TAB: Record<PreviewKey, { subject: string; body: string }> = {
    ack: { subject: email.ackSubject, body: email.ackBody },
    approved: { subject: email.approvedSubject, body: email.approvedBody },
    declined: { subject: email.declinedSubject, body: email.declinedBody },
    details: { subject: email.detailsRequestSubject, body: email.detailsRequestBody },
    back: { subject: email.boardingAckSubject, body: email.boardingAckBody },
    bconfirmed: { subject: email.boardingConfirmedSubject, body: email.boardingConfirmedBody },
    bdeclined: { subject: email.boardingDeclinedSubject, body: email.boardingDeclinedBody },
  };
  const picked = BY_TAB[tab];

  const subject = renderTemplate(picked.subject, vars);
  const body = renderTemplate(picked.body, vars);
  const fromLine = `${email.fromName || businessName} <${email.fromAddress || "not set"}>`;

  async function sendTest() {
    if (!to.trim()) {
      setResult({ ok: false, text: "Enter an address to send the test to." });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const r = await sendEmail({
        to: to.trim(),
        subject: `[Test] ${subject}`,
        body,
        from: {
          fromName: email.fromName,
          fromAddress: email.fromAddress,
          replyTo: email.replyTo,
        },
      });
      if (r.skipped) {
        setResult({
          ok: false,
          text: "Email is not configured — add RESEND_API_KEY to .env.local and restart the server.",
        });
      } else if (r.error) {
        // The overwhelmingly common first-run failure. Resend only sends
        // from a domain you control the DNS for, so a personal gmail/
        // outlook address can never be verified — say so, and point at the
        // sandbox sender that works without a domain.
        const unverified = /not verified|verify your domain/i.test(r.error);
        setResult({
          ok: false,
          text: unverified
            ? `${r.error}\n\nTo test right now, set the From address to onboarding@resend.dev — Resend's sandbox sender, which only delivers to the address on your Resend account. For real dogs, add your own domain at resend.com/domains and send from that. Your personal address still works as the Reply-to.`
            : r.error,
        });
      } else {
        setResult({ ok: true, text: `Sent to ${to.trim()}. Check the inbox (and spam).` });
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-line-soft p-3.5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        Preview &amp; test
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {PREVIEW_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
              tab === t.key
                ? "bg-accent-500 text-accent-ink shadow-card"
                : "border border-line bg-surface text-ink-2 hover:border-accent-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Rendered with sample answers so the placeholders resolve. */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line-soft bg-surface-2 px-3.5 py-2 text-[11px] text-ink-3">
          <p>
            <span className="text-ink-3">From</span>{" "}
            <span className={email.fromAddress ? "text-ink-2" : "font-medium text-rose-500"}>
              {fromLine}
            </span>
          </p>
          <p className="mt-0.5 text-sm font-medium text-ink">{subject}</p>
        </div>
        <div className="whitespace-pre-wrap px-3.5 py-3 text-sm leading-relaxed text-ink-2">
          {body}
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-ink-3">
        Filled in with sample answers — {SAMPLE.owner}, {SAMPLE.dogs}, {SAMPLE.phone},{" "}
        {SAMPLE.dropoff} to {SAMPLE.pickup}.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="your@email.com"
          className={`${inputClass} sm:w-64`}
        />
        <button
          onClick={sendTest}
          disabled={sending}
          className="whitespace-nowrap rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-300 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send test"}
        </button>
      </div>
      {result && (
        <p
          className={`mt-2 whitespace-pre-wrap text-xs font-medium ${
            result.ok ? "text-emerald-600" : "text-rose-500"
          }`}
        >
          {result.text}
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-ink-3">
        The test uses the addresses typed above, saved or not. The From address has to be on the
        domain you verified with Resend, or it will be rejected.
      </p>
    </div>
  );
}

// One editable message. Collapsed by default — three full templates open at
// once would bury the rest of the section.
function EmailTemplate({
  label,
  subject,
  body,
  onSubject,
  onBody,
}: {
  label: string;
  subject: string;
  body: string;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-line-soft">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-ink-2">{label}</span>
        <span className="ml-auto text-xs text-ink-3">{open ? "Hide" : "Edit"}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line-soft p-3.5">
          <Field label="Subject">
            <input value={subject} onChange={(e) => onSubject(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Message">
            <textarea
              value={body}
              onChange={(e) => onBody(e.target.value)}
              rows={12}
              className={`${inputClass} leading-relaxed`}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3">{label}</label>
      {children}
    </div>
  );
}


function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {blurb && <p className="mb-3 mt-1 text-[11px] text-ink-3">{blurb}</p>}
      {!blurb && <div className="mb-3" />}
      {children}
    </section>
  );
}

// The public forms are only useful if the business can find their
// addresses, so the links and iframe snippets live where staff already are
// rather than buried in a settings page.
const PUBLIC_FORMS: { path: string; label: string; blurb: string; queue: string }[] = [
  {
    path: "/enroll",
    label: "New client enrollment",
    blurb: "Full profile, waiver and vaccinations for a first-time client.",
    queue: "/requests?tab=enrollments",
  },
  {
    path: "/book",
    label: "Boarding request",
    blurb: "Existing clients asking for stay dates.",
    queue: "/requests?tab=boarding",
  },
];

function OnlineForms() {
  const [origin, setOrigin] = useState("");

  // Read after mount — there's no window during the server render.
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <>
      <p className="mb-3 text-[11px] text-ink-3">
        Everything submitted through these waits for your approval — nothing books itself.
      </p>
      <div className="space-y-4">
        {PUBLIC_FORMS.map((f) => (
          <ShareRow key={f.path} form={f} origin={origin} />
        ))}
      </div>
    </>
  );
}

function ShareRow({
  form,
  origin,
}: {
  form: (typeof PUBLIC_FORMS)[number];
  origin: string;
}) {
  const [copied, setCopied] = useState("");

  const url = `${origin}${form.path}`;
  const snippet = `<iframe src="${origin}${form.path}?embed=1" title="${form.label}" style="width:100%;height:1200px;border:0" loading="lazy"></iframe>`;

  async function copy(what: "link" | "embed", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  }

  return (
    <div className="rounded-xl border border-line-soft p-3.5">
      <p className="text-sm font-medium text-ink">{form.label}</p>
      <p className="mb-2 text-[11px] text-ink-3">
        {form.blurb} Goes to{" "}
        <Link href={form.queue} className="text-accent-600 hover:underline">
          {form.queue}
        </Link>
        .
      </p>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
            {url || "…"}
          </code>
          <button
            onClick={() => copy("link", url)}
            className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
          >
            {copied === "link" ? "Copied ✓" : "Copy link"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
          >
            Preview →
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
            {snippet}
          </code>
          <button
            onClick={() => copy("embed", snippet)}
            className="rounded-xl border border-line px-3 py-2 text-xs font-medium text-ink-2 hover:border-accent-300"
          >
            {copied === "embed" ? "Copied ✓" : "Copy embed"}
          </button>
        </div>
      </div>
    </div>
  );
}
