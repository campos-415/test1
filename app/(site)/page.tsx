import Link from "next/link";
import type { Metadata } from "next";
import Section from "@/components/Section";
import ServiceCard from "@/components/ServiceCard";
import CTABand from "@/components/CTABand";
import { BUSINESS } from "@/lib/business";
import { AddressPill, HoursLine } from "@/components/BusinessBits";
import { HeroPhoto } from "@/components/SitePhotoSpots";
import Reviews from "@/components/Reviews";
import { ReviewSummary } from "@/components/Reviews";
import { loadSettings } from "@/lib/settings";

// Copy comes from Settings → Content. Read on the server rather than through
// the client provider so search engines and link previews see the real words
// instead of the shipped defaults.
export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.home;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/" } };
}

export default async function HomePage() {
  const settings = await loadSettings();
  const c = settings.content.home;

  return (
    <>
      <section className="border-b border-slate-100 bg-gradient-to-b from-accent-50/60 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-24">
          <div>
            <AddressPill />
            <p className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3.5 py-1.5 text-sm font-semibold text-accent-700">
              <ReviewSummary />
            </p>
            <h1 className="font-display text-4xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              {settings.content.tagline}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600">{c.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/enroll"
                className="rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600">
                {c.primaryCta}
              </Link>
              <Link
                href="/book"
                className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-accent-300">
                {c.secondaryCta}
              </Link>
            </div>
            <HoursLine />
          </div>
          <HeroPhoto
            kind="hero"
            fallbackAlt={`Dogs playing together at ${BUSINESS.name}`}
            priority
          />
        </div>
      </section>

      {c.services.length > 0 && (
        <Section {...c.offer}>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {c.services.map((service) => (
              <ServiceCard key={service.href} {...service} />
            ))}
          </div>
        </Section>
      )}

      {c.valueProps.length > 0 && (
        <section className="bg-slate-50">
          <Section {...c.why}>
            <div className="grid gap-8 sm:grid-cols-2">
              {c.valueProps.map((prop) => (
                <div key={prop.title} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-lg">
                    🐕
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {prop.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{prop.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </section>
      )}

      <Section {...c.teamTeaser}>
        <Link
          href="/about-us"
          className="inline-block text-sm font-semibold text-accent-600 hover:text-accent-700">
          {c.teamLinkLabel}
        </Link>
      </Section>

      {settings.reviews.enabled && settings.reviews.items.length > 0 && (
        <section className="bg-slate-50">
          <Section {...c.reviewsHeading}>
            <Reviews />
          </Section>
        </section>
      )}

      <CTABand />
    </>
  );
}
