import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.boarding;
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: "/boarding" },
  };
}

export default async function BoardingPage() {
  const c = (await loadSettings()).content.boarding;

  return (
    <>
      <PageHero {...c.hero} primaryLabel="Reserve Boarding" primaryHref="/book" />

      {c.amenities.length > 0 && (
        <Section {...c.included}>
          <div className="grid gap-6 sm:grid-cols-2">
            {c.amenities.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
                <h3 className="font-display text-lg font-semibold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      <section className="bg-slate-50">
        <Section {...c.goodToKnow}>
          <ul className="space-y-3 text-sm text-slate-600">
            {c.goodToKnowItems.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="mt-0.5 text-accent-500">✓</span>
                {item}
              </li>
            ))}
          </ul>
          {c.note && (
            <p className="mt-6 text-sm text-slate-500">
              {c.note}{" "}
              <Link href="/prices" className="font-semibold text-accent-600">
                See current pricing →
              </Link>
            </p>
          )}
        </Section>
      </section>

      <CTABand {...c.cta} />
    </>
  );
}
