"use client";

import Link from "next/link";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import { HELP_TOPICS } from "@/lib/helpContent";

// The index behind the ? in the header.
//
// The ? answers the screen somebody is on, which is where help is actually
// wanted. This page is for the other case: reading the lot, on the first day,
// or looking for the screen that does the thing you half remember.

export default function HelpPage() {
  return (
    <StaffGate title="How to">
      <div className="mx-auto max-w-3xl px-5 py-8">
        <StaffNav current="/help" />

        <h1 className="font-display text-2xl font-semibold text-ink">How to use this</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-3">
          Every screen has a <span className="font-medium text-ink-2">？</span> in the header that
          explains that screen. This is all of it in one place.
        </p>

        <div className="mt-6 space-y-4">
          {HELP_TOPICS.map((topic) => (
            <section
              key={topic.key}
              className="rounded-2xl border border-line bg-surface p-5 shadow-card"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="font-display text-base font-semibold text-ink">{topic.title}</h2>
                {topic.key.startsWith("/") && (
                  <Link
                    href={topic.key}
                    className="text-xs font-medium text-accent-600 hover:underline"
                  >
                    Open it →
                  </Link>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{topic.summary}</p>

              <dl className="mt-3 space-y-3">
                {topic.points.map((p) => (
                  <div key={p.heading} className="rounded-xl bg-surface-2/60 p-3">
                    <dt className="text-xs font-semibold text-ink">{p.heading}</dt>
                    <dd className="mt-1 text-xs leading-relaxed text-ink-2">{p.body}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </StaffGate>
  );
}
