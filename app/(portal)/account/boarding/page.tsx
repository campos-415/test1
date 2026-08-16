"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BoardingRequestForm from "@/components/BoardingRequestForm";
import CustomerGate from "@/components/CustomerGate";
import { CustomerRequest, Household, loadHouseholdData } from "@/lib/customer";
import { prettyDateKey } from "@/lib/dates";
import { Dog } from "@/types";

export default function BoardingPage() {
  return <CustomerGate>{(household) => <RequestBoarding household={household} />}</CustomerGate>;
}

/**
 * Asking for a stay. Not booking one.
 *
 * The same BoardingRequestForm the website and the lobby iPad use, and the
 * same pending queue behind it — approving is still what creates a real
 * reservation. What differs is only how much it has to ask for: the account
 * knows who they are and which dogs they have, so it does not.
 */
function RequestBoarding({ household }: { household: Household }) {
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const data = await loadHouseholdData();
        if (!live || !data) return;
        setDogs(data.dogs);
        setRequests(data.requests);
      } catch (e) {
        console.error("Loading the dogs failed:", e);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;

  const pending = requests.filter((r) => r.status === "pending");
  // Splitting a household name into two fields is guesswork, and the form
  // wants both. The last word is the closest thing to a surname that the
  // single stored name gives.
  const parts = (household.owner_name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.slice(0, -1).join(" ") || parts[0] || "";
  const lastName = parts.length > 1 ? parts[parts.length - 1] : "";

  // A household stored with one word for a name cannot send a request: the
  // form requires a surname, it is filled in from here, and it is locked —
  // so the client would be told to enter a last name into a field they
  // cannot reach. Sending them to fix it is the only way out of that.
  if (!lastName) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-4">
        <p className="text-sm font-medium text-amber-900">One thing first</p>
        <p className="mt-1 text-sm leading-relaxed text-amber-900">
          We only have one name on file for you, and a boarding request needs a first and last
          name. Add your last name and this form will be ready.
        </p>
        <Link
          href="/account/details"
          className="mt-3 inline-block rounded-xl bg-accent-500 px-5 py-2 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
        >
          Add your last name
        </Link>
      </div>
    );
  }

  return (
    <div>
      {pending.length > 0 && (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            You already have {pending.length === 1 ? "a request" : `${pending.length} requests`}{" "}
            with us.
          </p>
          <ul className="mt-1 space-y-0.5">
            {pending.map((r) => (
              <li key={r.id} className="text-xs text-amber-800">
                {r.dog_names.join(", ")} · {prettyDateKey(r.start_date)} to{" "}
                {prettyDateKey(r.end_date)} — we will email you to confirm.
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-800">
            Sending another is fine if the dates have changed — give us a ring on the number below
            if you would rather we amended that one.
          </p>
        </div>
      )}

      {dogs.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-4 py-4">
          <p className="text-sm text-ink-2">
            We do not have a dog on file for you yet, and every boarding dog needs an enrollment and
            a meet &amp; greet first.
          </p>
          <Link
            href="/enroll"
            className="mt-3 inline-block rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-medium text-accent-ink shadow-card"
          >
            Start an enrollment
          </Link>
        </div>
      ) : (
        <BoardingRequestForm
          source="portal"
          prefill={{
            owner_name: firstName,
            last_name: lastName,
            phone: household.phone,
            email: household.email ?? "",
          }}
          lockContact
          knownDogs={dogs.map((d) => d.dog_name).filter(Boolean)}
        />
      )}
    </div>
  );
}
