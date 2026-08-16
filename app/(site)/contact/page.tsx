import type { Metadata } from "next";
import Section from "@/components/Section";
import ContactForm from "@/components/ContactForm";
import { ContactCards } from "@/components/BusinessBits";
import { loadSettings } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const { seo } = (await loadSettings()).content.contact;
  return { title: seo.title, description: seo.description, alternates: { canonical: "/contact" } };
}

export default async function ContactPage() {
  const c = (await loadSettings()).content.contact;

  return (
    <Section {...c.heading} className="pt-14 sm:pt-20">
      <div className="grid gap-10 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ContactForm />
        </div>
        <ContactCards />
      </div>
    </Section>
  );
}
