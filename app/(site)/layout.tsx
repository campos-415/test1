import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { getBusiness } from "@/lib/business";
import { loadSettings } from "@/lib/settings";
import { redirect } from "next/navigation";

// The public website's chrome. A route group, so the folder name adds no
// path segment — app/(site)/prices still serves /prices — which lets the
// marketing pages share a header and footer that the kiosk and staff pages
// never see.
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Structured data is rendered on the server, where the client-side
  // settings provider has not run. Loading them here is what keeps the
  // address and phone search engines see in step with the live site.
  const settings = await loadSettings();

  // Businesses that already have a website turn the built-in one off and use
  // this deployment purely as the back office. One check here covers every
  // marketing page, since they all render inside this layout.
  if (!settings.site.enabled) {
    redirect(settings.site.externalUrl || "/kiosk");
  }

  const BUSINESS = getBusiness();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: BUSINESS.name,
    "@id": BUSINESS.domain,
    url: BUSINESS.domain,
    telephone: BUSINESS.phone,
    email: BUSINESS.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: BUSINESS.address.city,
      addressRegion: BUSINESS.address.state,
      postalCode: BUSINESS.address.zip,
      addressCountry: "US",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "07:00",
        closes: "19:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday"],
        opens: "09:00",
        closes: "17:00",
      },
    ],
    sameAs: [BUSINESS.instagram],
    priceRange: "$$",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
