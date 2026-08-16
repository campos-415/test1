"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import CustomerGate from "@/components/CustomerGate";
import { Field, inputClass } from "@/components/FormBits";
import { formatPhoneInput } from "@/lib/phone";
import { Household, HouseholdDetails, saveHouseholdDetails } from "@/lib/customer";
import useCustomer from "@/components/useCustomer";

export default function DetailsPage() {
  return <CustomerGate>{(household) => <Details household={household} />}</CustomerGate>;
}

function fromHousehold(h: Household): HouseholdDetails {
  return {
    owner_name: h.owner_name ?? "",
    email: h.email ?? "",
    address: h.address ?? "",
    city: h.city ?? "",
    state: h.state ?? "",
    zip: h.zip ?? "",
    emergency_name: h.emergency_name ?? "",
    emergency_phone: h.emergency_phone ?? "",
    emergency_relation: h.emergency_relation ?? "",
    vet_name: h.vet_name ?? "",
    vet_phone: h.vet_phone ?? "",
    vet_address: h.vet_address ?? "",
  };
}

function Details({ household }: { household: Household }) {
  const { refresh } = useCustomer();
  const [form, setForm] = useState<HouseholdDetails>(fromHousehold(household));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof HouseholdDetails>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  // The database keeps one name. The form asks for two and joins them, which
  // is the smaller change: splitting the column would mean a migration and
  // every screen that reads owner_name. The last word is the surname, which
  // is exactly the assumption the booking form already makes when it reads
  // this back — so writing it in that shape is what makes the two agree.
  const parts = form.owner_name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.slice(0, -1).join(" ") || parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";

  function setName(first: string, last: string) {
    set("owner_name", [first.trim(), last.trim()].filter(Boolean).join(" "));
  }

  async function save() {
    if (!firstName.trim() || !lastName.trim()) {
      setError(
        "We need a first name and a last name — a booking cannot be sent without both."
      );
      return;
    }
    if (!form.email.trim()) {
      setError("We need an email address to reach you about your dog.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveHouseholdDetails(form);
      await refresh();
      setSaved(true);
    } catch (e) {
      console.error("Saving the details failed:", e);
      setError("We could not save that. Try again in a moment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Your details
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Keeping these current is what lets us reach you, and your vet, on a day when it matters.
        </p>
      </div>

      <Card title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Two fields, not one.
              A single "Name" box gets a first name typed into it, and then a
              boarding request cannot be sent: that form wants a surname, the
              portal fills it in from here, and the client is left staring at
              "enter your last name" above a field they cannot reach. Asking
              for both is how the booking works at all. */}
          <Field label="First name" required>
            <input
              value={firstName}
              onChange={(e) => setName(e.target.value, lastName)}
              autoComplete="given-name"
              className={inputClass}
            />
          </Field>
          <Field label="Last name" required>
            <input
              value={lastName}
              onChange={(e) => setName(firstName, e.target.value)}
              autoComplete="family-name"
              className={inputClass}
            />
          </Field>
          <Field label="Email" required hint="Where confirmations and reminders go.">
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              autoComplete="email"
              className={inputClass}
            />
          </Field>
        </div>

        {/* Read-only, and the sentence underneath is the whole reason. Every
            record in the household hangs off this number, so changing it is
            not a form field - it is a conversation with the front desk. */}
        <div className="mt-3 rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Phone number
          </p>
          <p className="mt-0.5 text-sm text-ink-2">{household.phone}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            This is how your dogs are filed with us, so give us a ring to change it and we will
            move everything across properly.
          </p>
        </div>
      </Card>

      <Card title="Address">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street">
              <input
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                autoComplete="street-address"
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="City">
            <input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <input
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="ZIP">
              <input
                value={form.zip}
                onChange={(e) => set("zip", e.target.value)}
                inputMode="numeric"
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Emergency contact" blurb="Somebody we can reach if we cannot reach you.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              value={form.emergency_name}
              onChange={(e) => set("emergency_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.emergency_phone}
              onChange={(e) => set("emergency_phone", formatPhoneInput(e.target.value))}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <Field label="Relationship">
            <input
              value={form.emergency_relation}
              onChange={(e) => set("emergency_relation", e.target.value)}
              placeholder="Partner, neighbour, sister…"
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card title="Your vet">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Practice name">
            <input
              value={form.vet_name}
              onChange={(e) => set("vet_name", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.vet_phone}
              onChange={(e) => set("vet_phone", formatPhoneInput(e.target.value))}
              inputMode="tel"
              className={inputClass}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <input
                value={form.vet_address}
                onChange={(e) => set("vet_address", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
      </Card>

      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <BusyButton busy={saving} busyLabel="Saving…" onClick={save} className="py-2.5">
          Save changes
        </BusyButton>
        {saved && <span className="text-xs font-medium text-emerald-700">Saved.</span>}
      </div>
    </div>
  );
}

function Card({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {blurb && <p className="mt-0.5 mb-3 text-[11px] text-ink-3">{blurb}</p>}
      <div className={blurb ? "" : "mt-3"}>{children}</div>
    </section>
  );
}
