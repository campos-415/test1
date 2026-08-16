import type { Metadata } from "next";
import Section from "@/components/Section";
import PriceTables from "@/components/PriceTables";
import CTABand from "@/components/CTABand";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.prices;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/prices" } };
}

export default async function PricesPage() {
  const c = (await loadSettings()).content.prices;

  return (
    <>
      <Section {...c.heading} className="pt-14 sm:pt-20">
        <PriceTables />
      </Section>

      <CTABand />
    </>
  );
}
