// The business's public identity — name, address, phone, hours — as the
// website renders it.
//
// These used to be hardcoded here. They now come from the same `settings`
// row that drives pricing and branding, so the front desk can change the
// phone number or the opening hours without a deploy. This file is the
// shape and the fallback; getBusiness() reads the live values.
//
// Consistent name/address/phone across every page is a real local-SEO
// signal, which is why it still resolves through exactly one place.

import { getSettings } from "@/lib/settings";

export interface BusinessInfo {
  name: string;
  shortName: string;
  tagline: string;
  phone: string;
  phoneHref: string;
  email: string;
  address: { street: string; city: string; state: string; zip: string };
  hours: { daycare: string; weekend: string; boarding: string };
  instagram: string;
  instagramHandle: string;
  domain: string;
}

/** Digits only, so any formatting staff type still dials correctly. */
function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // A 10-digit US number needs the country code to dial from a mobile.
  return `tel:+${digits.length === 10 ? "1" : ""}${digits}`;
}

export function getBusiness(): BusinessInfo {
  const b = getSettings().business;
  return {
    name: b.name,
    shortName: b.name,
    // The kiosk tagline ("Sign your pup in or out") is an instruction, not a
    // slogan, so the website keeps its own line rather than borrowing it.
    // Edited under Settings → Content.
    tagline: getSettings().content.tagline,
    phone: b.phone,
    phoneHref: telHref(b.phone),
    email: b.email,
    address: { street: b.street, city: b.city, state: b.state, zip: b.zip },
    hours: { daycare: b.hoursWeekday, weekend: b.hoursWeekend, boarding: b.hoursBoarding },
    instagram: b.instagram,
    instagramHandle: b.instagramHandle,
    domain: b.domain,
  };
}

/**
 * Snapshot for module scope and server components, where the settings row
 * has not necessarily loaded. Reads whatever the cache holds — the shipped
 * defaults before load, the saved values after — so a page rendered early
 * shows real content rather than blanks.
 *
 * Anything that must react to a settings change should call getBusiness()
 * inside a client component instead, so it re-renders when they arrive.
 */
export const BUSINESS: BusinessInfo = new Proxy({} as BusinessInfo, {
  get: (_t, key: string) => getBusiness()[key as keyof BusinessInfo],
});

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/dog-daycare", label: "Daycare" },
  { href: "/boarding", label: "Boarding" },
  { href: "/bath", label: "Bath" },
  { href: "/dog-walking", label: "Dog Walking" },
  { href: "/prices", label: "Prices" },
  { href: "/gallery", label: "Gallery" },
  { href: "/about-us", label: "About Us" },
  { href: "/contact", label: "Contact" },
];
