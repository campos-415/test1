"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { helpFor } from "@/lib/helpContent";

/**
 * The ? in the staff header.
 *
 * Answers the screen the person is on rather than opening a manual, because
 * the moment anybody wants help is the moment they are stuck on something
 * specific — and a page of everything is a page they have to search.
 *
 * /help is still there, linked from the bottom of this, for reading the lot.
 */
export default function HelpButton({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const topic = helpFor(current);

  // Escape closes it, and the page behind stops scrolling under the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`How to use ${topic.title}`}
        title={`How to use ${topic.title}`}
        className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-300 hover:text-ink-2"
      >
        ？
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`How to use ${topic.title}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 print:hidden sm:items-center sm:p-6"
          onClick={() => setOpen(false)}
        >
          {/* A sheet from the bottom on a phone, a dialog on a desk. Both stop
              the click from reaching the backdrop that closes them. */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-card sm:rounded-2xl"
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold text-ink">{topic.title}</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{topic.summary}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-3 hover:border-line"
              >
                ✕
              </button>
            </div>

            <ul className="space-y-3">
              {topic.points.map((p) => (
                <li key={p.heading} className="rounded-xl bg-surface-2/60 p-3">
                  <p className="text-xs font-semibold text-ink">{p.heading}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-2">{p.body}</p>
                </li>
              ))}
            </ul>

            <Link
              href="/help"
              onClick={() => setOpen(false)}
              className="mt-4 inline-block text-xs font-medium text-accent-600 hover:underline"
            >
              All the how-to notes →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
