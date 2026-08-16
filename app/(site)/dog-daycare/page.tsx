import type { Metadata } from "next";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.daycare;
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: "/dog-daycare" },
  };
}

export default async function DaycarePage() {
  const c = (await loadSettings()).content.daycare;

  return (
    <>
      <PageHero {...c.hero} primaryHref="/enroll" />

      <Section {...c.how}>
        {c.options.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2">
            {c.options.map((opt) => (
              <div
                key={opt.title}
                className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
                <h3 className="font-display text-lg font-semibold text-slate-900">{opt.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{opt.body}</p>
              </div>
            ))}
          </div>
        )}
        {c.note && (
          <p className="mt-6 text-sm text-slate-500">
            {c.note}{" "}
            <Link href="/prices" className="font-semibold text-accent-600">
              See current pricing →
            </Link>
          </p>
        )}
      </Section>

      {c.requirementItems.length > 0 && (
        <section className="bg-slate-50">
          <Section {...c.requirements}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {c.requirementItems.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600 shadow-card">
                  <span className="mt-0.5 text-accent-500">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </Section>
        </section>
      )}

      <Section {...c.extra}>
        {c.extraLinkLabel && (
          <Link
            href={c.extraLinkHref || "/bath"}
            className="text-sm font-semibold text-accent-600 hover:text-accent-700">
            {c.extraLinkLabel}
          </Link>
        )}
      </Section>

      <CTABand {...c.cta} />
    </>
  );
}
