"use client";

import Link from "next/link";
import { useState } from "react";
import CustomerGate from "@/components/CustomerGate";
import EnrollmentForm from "@/components/EnrollmentForm";
import { useSettings } from "@/components/SettingsProvider";
import { Household } from "@/lib/customer";

// Adding another dog, from the account.
//
// It is the ordinary stage-one enrollment form, prefilled and with the
// contact half locked, and it files into the same pending queue the public
// form feeds. That is deliberate rather than lazy: a second dog is still a
// dog nobody here has met, and it needs the same vaccination records, the
// same waiver and the same meet & greet as a first one. A shortcut that
// skipped any of that would put an unassessed dog into a playgroup.
//
// What the household does not have to do again is prove who they are. The
// name, number and email come from the account, and the database stamps the
// household onto the row from the session rather than reading it off the
// form — so this cannot file an application against anybody else.
export default function AddDogPage() {
  return <CustomerGate>{(household) => <AddDog household={household} />}</CustomerGate>;
}

function AddDog({ household }: { household: Household }) {
  const { settings } = useSettings();
  const [sent, setSent] = useState(false);

  const parts = (household.owner_name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.slice(0, -1).join(" ") || parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";

  // Has this household already answered stage two?
  //
  // Checked against what stage two actually collects rather than assumed
  // from "they have an account": a household staff invited directly may hold
  // an account and still never have been asked these. Getting that backwards
  // in the generous direction would file the enrollment as complete and
  // quietly skip questions nobody has answered — the address to reach them
  // at and the vet to ring.
  const detailsOnFile = Boolean(
    household.address?.trim() && household.vet_name?.trim() && household.emergency_name?.trim()
  );

  if (sent) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-500 text-2xl text-accent-ink shadow-card">
          ✓
        </div>
        <p className="mt-4 text-lg font-medium text-ink">That is with us.</p>
        <p className="mt-1 text-sm text-ink-3">
          {settings.business.name} will look over the profile and be in touch to book a meet &amp;
          greet. Your other {household.owner_name ? "dogs are" : "dogs are"} unaffected — nothing
          changes for them.
        </p>
        <Link
          href="/account"
          className="mt-4 inline-block rounded-xl bg-accent-500 px-6 py-2.5 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
        >
          Back to your account
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Add another dog
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {detailsOnFile
            ? "We have your details from last time, so this is just about the dog: their vaccinations, and a meet & greet before their first full day."
            : "Same as the first time — we need their vaccinations and a meet & greet before their first full day. We have filled in your details already."}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <EnrollmentForm
          source="web"
          embed
          lockContact
          detailsOnFile={detailsOnFile}
          prefill={{
            owner_name: firstName,
            last_name: lastName,
            phone: household.phone,
            email: household.email ?? "",
          }}
          onSubmitted={() => setSent(true)}
        />
      </div>
    </div>
  );
}
