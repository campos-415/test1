import type { Metadata } from "next";
import Section from "@/components/Section";
import CTABand from "@/components/CTABand";
import GalleryGrid from "@/components/GalleryGrid";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.gallery;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/gallery" } };
}

// The photos themselves are uploaded on /settings and rendered by
// GalleryGrid, which falls back to stock images until there are any.
export default async function GalleryPage() {
  const c = (await loadSettings()).content.gallery;

  return (
    <>
      <Section {...c.heading} className="pt-14 sm:pt-20">
        <GalleryGrid />
      </Section>

      <CTABand />
    </>
  );
}
