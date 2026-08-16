"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { loadPendingCount } from "@/lib/enrollment";
import { loadPendingBoardingCount } from "@/lib/boardingRequest";
import { showDesktopAlert } from "@/lib/notify";
import { STAFF_SIGNED_OUT_HREF, displayName, signOut } from "@/lib/auth";
import { useSettings } from "@/components/SettingsProvider";
import useRole from "@/components/useRole";
import HelpButton from "@/components/HelpButton";
import { isManagerOrAbove } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// Dog and owner profiles are deliberately absent — they're reached by
// clicking a dog's name anywhere in the app, not from the nav.
//
// `manager` marks a link an employee cannot open, and each one is matched by
// a refusal on the page itself - hiding a link is not a permission, it is a
// suggestion, and anybody can type an address.
//
//   Settings    changes prices, branding, staff and the website.
//   Day report  totals the day takings, which is a manager matter.
//
// Packages deliberately has no mark: an employee needs to see what a dog has
// left in order to sign it in, and the selling and correcting inside it is
// gated on its own.
//
// The list is the one place to add the next one. Offering a link that ends
// in a refusal screen is how staff learn to distrust the nav.
const LINKS: { href: string; label: string; manager?: true }[] = [
  { href: "/dashboard", label: "🏠 Dashboard" },
  { href: "/in-house", label: "📋 In House" },
  { href: "/calendar", label: "🗓️ Calendar" },
  { href: "/packages", label: "📦 Packages" },
  { href: "/requests", label: "📥 Requests" },
  { href: "/day-report", label: "📊 Day report", manager: true },
  { href: "/settings", label: "⚙️ Settings", manager: true },
];

// How often to re-check for new requests. A minute is frequent enough that
// the front desk hears about a booking while the client is still on the
// website, and cheap enough to run on every staff page — it's two COUNT
// queries with no rows returned.
const POLL_MS = 60_000;

export default function StaffNav({ current }: { current: string }) {
  // Requests arrive from the website with nobody watching for them, so the
  // count rides along on every staff page — otherwise a submission sits
  // unseen until someone thinks to check.
  const [counts, setCounts] = useState({ enrollments: 0, boarding: 0 });
  const [toast, setToast] = useState("");
  // Previous totals, so a rise can be told from a first load. Starts null
  // so the very first poll never announces the backlog as "new".
  const seen = useRef<{ enrollments: number; boarding: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Only on small screens. Everything below sm collapses into one bar and a
  // menu, because the desk layout wrapped to four rows on a phone - an
  // account row plus three rows of page pills - and that was most of the
  // first screen before any content appeared.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    getSupabase().auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  // Navigating is the end of the menu. Without this it stays open over the
  // page that was just chosen.
  useEffect(() => {
    setMenuOpen(false);
  }, [current]);

  const poll = useCallback(async () => {
    const [enrollments, boarding] = await Promise.all([
      loadPendingCount(),
      loadPendingBoardingCount(),
    ]);
    setCounts({ enrollments, boarding });

    const before = seen.current;
    seen.current = { enrollments, boarding };
    if (!before) return;

    const newEnrollments = Math.max(0, enrollments - before.enrollments);
    const newBoardings = Math.max(0, boarding - before.boarding);
    if (!newEnrollments && !newBoardings) return;

    const parts = [
      newEnrollments ? `${newEnrollments} new client form${newEnrollments === 1 ? "" : "s"}` : "",
      newBoardings ? `${newBoardings} boarding request${newBoardings === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    const message = parts.join(" and ");
    setToast(message);
    showDesktopAlert("New request", message);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    // Coming back to the tab is the other moment staff want a fresh number,
    // and it costs nothing when the page has been sitting in the background.
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  const pending = counts.enrollments + counts.boarding;

  // The same logo the kiosk and the public site show, from Settings → Brand,
  // falling back to the bundled mark until a business uploads its own.
  //
  // It replaced the current-page name that used to sit here. That name was
  // saying what every one of these pages already says in its own heading a
  // few pixels below, and on the pages whose route is not in the list — the
  // stay report, a dog profile — it fell back to the word "Staff", which
  // named nothing at all.
  const { name: businessName, logoData } = useSettings().settings.business;

  // What this account may actually open.
  //
  // Two deliberate fallbacks. A database with no roles migration run has no
  // roles to read (`unavailable`), and hiding the owner's own settings on the
  // strength of a missing table is a worse failure than showing them — the
  // same call app/settings/page.tsx makes. And while the role is still
  // loading the gated links are held back, because a link that appears a
  // moment late is easier to live with than one that vanishes under a thumb
  // already moving towards it.
  const { account, loading: roleLoading, unavailable: rolesUnavailable } = useRole();
  const mayManage = rolesUnavailable || isManagerOrAbove(account?.role ?? null);
  const links = LINKS.filter((l) => !l.manager || (!roleLoading && mayManage));

  const brand = (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoData || "/logo.svg"}
        alt=""
        className="h-8 w-auto max-w-[7rem] shrink-0 object-contain"
      />
      <span className="truncate font-display text-sm font-semibold text-ink">{businessName}</span>
    </Link>
  );

  // One pill, shared by the menu and the desk layout so the two cannot drift.
  const pageLink = (l: { href: string; label: string }, block = false) => (
    <Link
      key={l.href}
      href={l.href}
      onClick={() => setMenuOpen(false)}
      // The border stays on both states, transparent when active. Without it
      // the current link was 2px narrower than the others and every link
      // after it jumped sideways on navigation.
      className={`relative rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
        block ? "block" : ""
      } ${
        l.href === current
          ? "border-transparent bg-accent-500 text-accent-ink shadow-card"
          : "border-line bg-surface text-ink-2 hover:border-line"
      }`}
    >
      {l.label}
      {/* Taken out of the layout entirely. The count arrives from the network
          a moment after the page paints, and an inline badge widened this
          link on arrival, shoving every link after it sideways — the jump
          that made the bar look broken. */}
      {l.href === "/requests" && pending > 0 && (
        <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-card">
          {pending}
        </span>
      )}
    </Link>
  );

  const accountControls = (
    <>
      {/* Beside sign-out rather than among the page pills: it is about the
          person, not about where they are going. And every role gets it —
          changing your own password is not an administrative act, and it
          used to sit behind Settings where an employee could never reach
          it. */}
      <Link
        href="/my-account"
        className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-accent-300 hover:text-ink-2"
        title="Your password and two-factor sign-in"
      >
        🔑 Your sign-in
      </Link>
      <button
        onClick={async () => {
          await signOut();
          window.location.href = STAFF_SIGNED_OUT_HREF;
        }}
        className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-3 transition hover:border-rose-300 hover:text-rose-500"
        title="Sign out of this device"
      >
        ⏻ Sign out
      </button>
      <ThemeToggle />
      <Link
        href="/kiosk"
        className="rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-3 hover:border-line"
      >
        ← Kiosk
      </Link>
    </>
  );

  return (
    <>
      {/* Phones: the page you are on, and a way to leave it. Everything else
          is one tap away rather than occupying the top of every screen. */}
      <div className="mb-4 flex items-center gap-2 sm:hidden print:hidden">
        {brand}
        <div className="ml-auto shrink-0">
          <HelpButton current={current} />
        </div>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="relative shrink-0 rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2"
        >
          {menuOpen ? "✕ Close" : "☰ Menu"}
          {/* Only when shut. Open, the badge on Requests itself is showing. */}
          {!menuOpen && pending > 0 && (
            <span className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-card">
              {pending}
            </span>
          )}
        </button>
      </div>

      {menuOpen && (
        <div className="mb-4 space-y-1.5 rounded-2xl border border-line bg-surface p-2 shadow-card sm:hidden print:hidden">
          {links.map((l) => pageLink(l, true))}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            {accountControls}
            {user && (
              <span className="ml-auto truncate text-[11px] text-ink-3">
                {displayName(user)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Two rows, because they are two different things: who is signed in
          and where this device goes, above; where this session goes, below.
          Sharing one wrapping row meant the account controls changed place
          depending on how many page links happened to fit. */}
      <div className="mb-3 hidden items-center gap-3 sm:flex print:hidden">
        {brand}
        {user && (
          <span
            className="ml-auto truncate text-[11px] text-ink-3"
            title={user.email ?? undefined}
          >
            Signed in as <span className="font-medium text-ink-2">{displayName(user)}</span>
          </span>
        )}
        <div className={`flex shrink-0 items-center gap-2 ${user ? "" : "ml-auto"}`}>
          <HelpButton current={current} />
          {accountControls}
        </div>
      </div>

      <nav className="mb-6 hidden flex-wrap items-center gap-2 sm:flex print:hidden">
        {links.map((l) => pageLink(l))}
      </nav>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-xs rounded-2xl border border-accent-200 bg-surface p-4 shadow-lg print:hidden">
          <p className="text-sm font-medium text-ink">📥 {toast}</p>
          <div className="mt-2 flex items-center gap-3">
            <Link
              href="/requests"
              onClick={() => setToast("")}
              className="rounded-xl bg-accent-500 px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-600"
            >
              Review now
            </Link>
            <button
              onClick={() => setToast("")}
              className="text-xs font-medium text-ink-3 hover:text-ink-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
