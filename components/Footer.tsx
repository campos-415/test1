"use client";

import Link from "next/link";
import { NAV_LINKS } from "@/lib/business";
import { useBusiness } from "@/components/useBusiness";
import { useSettings } from "@/components/SettingsProvider";


export default function Footer() {
  const BUSINESS = useBusiness();
  // Both used to be hardcoded: the bundled logo regardless of what was
  // uploaded, and a sentence naming one street in the middle of a paragraph
  // on every page of every deployment.
  const { business, content } = useSettings().settings;
  const logoData = business.logoData;
  return (
    <footer className="border-t border-slate-100 bg-slate-50">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:px-8 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoData || "/logo.svg"}
                alt={BUSINESS.name}
                className="h-[52px] w-auto max-w-[180px] object-contain"
              />
            </span>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-slate-500">
            {BUSINESS.tagline} {content.footerBlurb}
          </p>
          <a
            href={BUSINESS.instagram}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block text-sm font-medium text-accent-600 hover:text-accent-700">
            {BUSINESS.instagramHandle} on Instagram
          </a>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900">Explore</p>
          <ul className="space-y-2">
            {NAV_LINKS.slice(1).map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-slate-500 hover:text-accent-600">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-3 text-sm font-semibold text-slate-900">
            Visit &amp; Contact
          </p>
          <ul className="space-y-2 text-sm text-slate-500">
            <li>
              {BUSINESS.address.street}
              <br />
              {BUSINESS.address.city}, {BUSINESS.address.state}{" "}
              {BUSINESS.address.zip}
            </li>
            <li>
              <a href={BUSINESS.phoneHref} className="hover:text-accent-600">
                {BUSINESS.phone}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${BUSINESS.email}`}
                className="hover:text-accent-600">
                {BUSINESS.email}
              </a>
            </li>
            <li className="pt-1 text-xs text-slate-400">
              {BUSINESS.hours.daycare}
              <br />
              {BUSINESS.hours.weekend }
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-slate-200 px-5 py-5 text-center text-xs text-slate-400 sm:px-8">
        © {new Date().getFullYear()} {BUSINESS.name}. All rights reserved.
      </div>
    </footer>
  );
}
