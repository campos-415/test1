"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import EnrollmentQueue from "@/components/EnrollmentQueue";
import BoardingQueue from "@/components/BoardingQueue";
import { loadPendingCount } from "@/lib/enrollment";
import { loadPendingBoardingCount } from "@/lib/boardingRequest";

// Everything a client has sent in, in one place. The two queues stay
// separate — approving an enrollment creates a dog, approving a booking
// creates a reservation, and they have different review checks — but staff
// only have one page to remember and one badge to watch.
export default function RequestsPage() {
  return (
    <StaffGate title="Requests">
      <Suspense fallback={null}>
        <Requests />
      </Suspense>
    </StaffGate>
  );
}

type Tab = "enrollments" | "boarding";

function Requests() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(
    params.get("tab") === "boarding" ? "boarding" : "enrollments"
  );
  const [counts, setCounts] = useState({ enrollments: 0, boarding: 0 });

  // Both numbers count PENDING rows only — the badge is a to-do list, not a
  // running total of everything ever submitted.
  //
  // They used to be read once on mount and never again, so approving three
  // requests left the tab still claiming three were waiting. Re-read whenever
  // a queue changes something.
  const refreshCounts = useCallback(() => {
    loadPendingCount().then((n) => setCounts((c) => ({ ...c, enrollments: n })));
    loadPendingBoardingCount().then((n) => setCounts((c) => ({ ...c, boarding: n })));
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  function pick(next: Tab) {
    setTab(next);
    // Kept in the URL so a tab can be linked to and survives a reload —
    // replace, not push, so Back leaves the page instead of cycling tabs.
    router.replace(`/requests?tab=${next}`);
  }

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "enrollments", label: "📝 New clients", count: counts.enrollments },
    { key: "boarding", label: "🗓️ Boarding", count: counts.boarding },
  ];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <StaffNav current="/requests" />

      <div className="mb-5">
        <h1 className="font-display text-2xl font-semibold text-ink">Requests</h1>
        <p className="text-sm text-ink-3">
          Everything clients have sent in from the kiosk or the website. Nothing takes effect until
          you approve it.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => pick(t.key)}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              tab === t.key
                ? "bg-accent-500 text-accent-ink shadow-card"
                : "border border-line bg-surface text-ink-2 hover:border-accent-300"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  tab === t.key ? "bg-white/25 text-white" : "bg-rose-500 text-white"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "enrollments" ? (
        <EnrollmentQueue onChanged={refreshCounts} />
      ) : (
        <BoardingQueue onChanged={refreshCounts} />
      )}
    </div>
  );
}
