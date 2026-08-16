import type { Metadata } from "next";
import Section from "@/components/Section";
import { HeroPhoto, TeamGrid } from "@/components/SitePhotoSpots";
import CTABand from "@/components/CTABand";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.about;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/about-us" } };
}

export default async function AboutPage() {
  const c = (await loadSettings()).content.about;

  return (
    <>
      <section className="border-b border-slate-100 bg-gradient-to-b from-accent-50/60 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:py-20">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-accent-600">
              {c.eyebrow}
            </p>
            <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {c.title}
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">{c.intro}</p>
          </div>
          <HeroPhoto kind="about" fallbackAlt="Dog enjoying time at daycare" />
        </div>
      </section>

      {c.team.length > 0 && (
        <Section {...c.teamHeading}>
          <TeamGrid />
        </Section>
      )}

      <section className="bg-slate-50">
        <Section {...c.approach} />
      </section>

      <CTABand />
    </>
  );
}
