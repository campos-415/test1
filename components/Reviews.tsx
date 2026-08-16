"use client";

// Renders on the client so it shows what staff actually saved.
//
// Settings load in the browser, so a server-rendered version would always
// paint the shipped defaults — the same reason the price tables are client
// components. The reviews still end up in the DOM for anyone reading the
// page; only the first server response lacks them.

import { useSettings } from "@/components/SettingsProvider";

function Stars({ rating }: { rating: number }) {
  const whole = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="text-accent-500" aria-label={`${whole} out of 5 stars`}>
      {"★".repeat(whole)}
      {"☆".repeat(5 - whole)}
    </span>
  );
}

/** The one-line rating, for the home page hero. */
export function ReviewSummary() {
  const { reviews } = useSettings().settings;
  if (!reviews.enabled || !reviews.items.length) return null;
  const average =
    reviews.items.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.items.length;
  return (
    <>
      ★ {average.toFixed(1)} ({reviews.items.length} {reviews.source} reviews)
    </>
  );
}

export default function Reviews() {
  const { reviews } = useSettings().settings;
  if (!reviews.enabled || !reviews.items.length) return null;

  const average =
    reviews.items.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.items.length;

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <Stars rating={average} />
        <p className="text-sm font-semibold text-slate-900">{average.toFixed(1)} out of 5</p>
        <p className="text-sm text-slate-500">
          based on {reviews.items.length} {reviews.source} reviews
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {reviews.items.map((review, i) => (
          <figure
            key={`${review.name}-${review.date}-${i}`}
            className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card"
          >
            <Stars rating={review.rating} />
            <blockquote className="mt-3 text-sm leading-relaxed text-slate-600">
              “{review.quote}”
            </blockquote>
            <figcaption className="mt-4 text-xs font-medium text-slate-400">
              {review.name} · {review.date} · {reviews.source}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
