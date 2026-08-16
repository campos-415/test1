import type { Metadata, Viewport } from "next";
import { Fredoka, Inter } from "next/font/google";
import "./globals.css";
import SettingsProvider from "@/components/SettingsProvider";
import { ThemeProvider } from "@/components/ThemeToggle";
import { getBusiness } from "@/lib/business";
import { loadSettings } from "@/lib/settings";

// Two faces, one app. The root layout carries only what BOTH need — fonts,
// the settings/theme providers, the html+body shell. The public website adds
// its own header, footer and SEO metadata in app/(site)/layout.tsx; the
// kiosk and staff pages stay chrome-free and bring their own nav.
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });

// A malformed domain in settings would otherwise throw here and take down
// every page, so it degrades to "no canonical base" instead.
function safeBase(): URL | undefined {
  try {
    return new URL(getBusiness().domain);
  } catch {
    return undefined;
  }
}

/**
 * A function, not a constant, because the business name has to be read
 * before it can be used.
 *
 * This was `export const metadata`, which is evaluated as the module loads —
 * before anything has fetched the settings row. getBusiness() therefore
 * returned the shipped defaults every time, and every page in every
 * deployment was titled "Doggy Daycare" no matter what the business was
 * actually called. The tab said it, a bookmark saved it, and a search engine
 * would have indexed it.
 *
 * Awaiting loadSettings() first fills the cache that getBusiness() reads.
 * It also makes these pages render per request rather than being baked at
 * build time, which is the right trade: a title baked from defaults is wrong
 * for the whole life of the deployment, and this content changes the moment
 * somebody edits Settings.
 */
export async function generateMetadata(): Promise<Metadata> {
  await loadSettings();
  const business = getBusiness();

  return {
    metadataBase: safeBase(),
    // A sensible default for the staff and kiosk routes. The marketing pages
    // override this with their own titles and descriptions.
    // The city comes from Settings -> Brand rather than being written in here,
    // so a second location does not advertise the first ones town.
    title: {
      default: [
        business.name,
        `Dog Daycare & Boarding${business.address.city ? ` in ${business.address.city}` : ""}`,
      ].join(" | "),
      template: `%s | ${business.name}`,
    },
    description:
      "Cage-free dog daycare and overnight boarding. Supervised play, bathing, and dog walking from a team that treats your dog like pack.",
    manifest: "/manifest.json",
    appleWebApp: { capable: true, statusBarStyle: "default", title: business.name },
  };
}

export const viewport: Viewport = {
  themeColor: "#F8FAFC",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${inter.variable}`}>
      <body className="font-body">
        {/* Hydrates the prices, catalogs, and branding every page reads. */}
        <SettingsProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
