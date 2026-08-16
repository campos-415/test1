"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { forgetCachedHousehold } from "@/lib/customer";
import { useSettings } from "@/components/SettingsProvider";
import useCustomer from "@/components/useCustomer";

// The header and navigation for the client portal.
//
// Deliberately not StaffNav. That one carries the queues, the day sheets,
// the reports and the settings, and every link on it goes somewhere a client
// has no business being. This has five links, all of which are things the
// requirements say a client may do.
const TABS: { href: string; label: string }[] = [
  { href: "/account", label: "Overview" },
  { href: "/account/history", label: "Visits & billing" },
  { href: "/account/documents", label: "Vaccinations" },
  { href: "/account/boarding", label: "Request boarding" },
  { href: "/account/details", label: "Your details" },
];

export default function PortalChrome({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const pathname = usePathname();
  const { household, signedIn } = useCustomer();

  // The claim link is opened by somebody who is not signed in yet, and
  // wrapping it in navigation they cannot use would be noise at the one
  // moment the screen has a single job.
  const bare = pathname?.startsWith("/account/claim") ?? false;

  return (
    <div className="min-h-screen bg-surface-2">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4 sm:px-8">
          <Link href={bare ? "/" : "/account"} className="flex items-center gap-3">
            {settings.business.logoData && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={settings.business.logoData}
                alt={settings.business.name}
                className="h-9 w-auto object-contain"
              />
            )}
            <div>
              <p className="font-display text-base font-semibold text-ink">
                {settings.business.name}
              </p>
              <p className="text-[11px] text-ink-3">
                {household?.owner_name ? household.owner_name : "Your account"}
              </p>
            </div>
          </Link>

          {signedIn && !bare && (
            <button
              onClick={async () => {
                forgetCachedHousehold();
                await getSupabase().auth.signOut();
                window.location.href = "/";
              }}
              className="ml-auto rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink-3 transition hover:border-rose-300 hover:text-rose-500"
            >
              Sign out
            </button>
          )}
        </div>

        {/* Only shown once there is a household to navigate. Before that the
            tabs would all lead to the same sign-in screen. */}
        {household && !bare && (
          <nav className="mx-auto max-w-3xl overflow-x-auto px-5 sm:px-8">
            <ul className="flex gap-1 pb-px">
              {TABS.map((tab) => {
                const active =
                  tab.href === "/account"
                    ? pathname === "/account"
                    : pathname?.startsWith(tab.href);
                return (
                  <li key={tab.href}>
                    <Link
                      href={tab.href}
                      className={`inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                        active
                          ? "border-accent-500 text-ink"
                          : "border-transparent text-ink-3 hover:text-ink-2"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">{children}</main>

      <footer className="mx-auto max-w-3xl px-5 pb-10 text-center sm:px-8">
        <p className="text-[11px] text-ink-3">
          Something not right? Ring us on{" "}
          <a href={`tel:${settings.business.phone}`} className="text-accent-600">
            {settings.business.phone}
          </a>{" "}
          and we will sort it out.
        </p>
      </footer>
    </div>
  );
}
