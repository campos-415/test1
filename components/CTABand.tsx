"use client";

import Link from "next/link";
import { useBusiness } from "@/components/useBusiness";
import { useSettings } from "@/components/SettingsProvider";

// Pages that want their own wording pass it; the rest fall back to the one
// pair of lines staff edit under Settings → Content, so changing the house
// call-to-action changes it in the eight places it appears.
export default function CTABand({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) {
  const BUSINESS = useBusiness();
  const { content } = useSettings().settings;
  const heading = title ?? content.cta.title;
  const sub = description ?? content.cta.description;
  return (
    <section className="bg-accent-500">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="max-w-lg">
          <h2 className="font-display text-2xl font-semibold text-white sm:text-3xl">
            {heading}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-accent-50">{sub}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/enroll"
            className="rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600">
            {content.home.primaryCta}
          </Link>
          <a
            href={BUSINESS.phoneHref}
            className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-accent-700 transition hover:bg-accent-50">
            Call {BUSINESS.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
