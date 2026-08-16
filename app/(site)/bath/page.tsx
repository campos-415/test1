import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.bath;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/bath" } };
}

export default async function BathPage() {
  const c = (await loadSettings()).content.bath;

  return (
    <>
      <PageHero {...c.hero} primaryHref="/enroll" />

      <Section {...c.included}>
        {c.items.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-3">
            {c.items.map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        )}
        {c.note && (
          <p className="mt-6 text-sm text-slate-500">
            {c.note}{" "}
            <Link href="/prices" className="font-semibold text-accent-600">
              See bath &amp; grooming rates →
            </Link>
          </p>
        )}
      </Section>

      <CTABand {...c.cta} />
    </>
  );
}
