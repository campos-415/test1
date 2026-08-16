"use client";

import { useRef } from "react";

// A button that visibly does something while it is doing something.
//
// The app already disabled its submit buttons during a send and swapped the
// label to "Sending…". On a fast connection that is a flicker; on a phone in
// a car park it is a button that looks broken. People press it again, and
// again, and the fourth press is the one they remember.
//
// So there is a spinner. It is not decoration - it is the only part of the
// feedback that keeps moving, and movement is what says "working" rather
// than "stuck". The label still changes, because a spinner alone does not
// say what is happening.
//
// The double-submit guard is belt and braces. `disabled` already stops a
// second click in React, but only once the state has been set: an async
// handler that awaits before setting `busy` leaves a window open, and the
// ref here closes it whatever the caller does.
export default function BusyButton({
  busy,
  busyLabel,
  onClick,
  children,
  disabled = false,
  variant = "primary",
  className = "",
  type = "button",
}: {
  busy: boolean;
  /** What to say while it works. Falls back to the label with an ellipsis. */
  busyLabel?: string;
  // Returns unknown rather than void: several handlers here resolve to a
  // boolean the caller uses elsewhere, and a void return type would reject
  // them for a difference that does not matter to a button.
  onClick?: () => unknown;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
  type?: "button" | "submit";
}) {
  const running = useRef(false);

  async function handle() {
    if (busy || disabled || running.current) return;
    running.current = true;
    try {
      await onClick?.();
    } finally {
      running.current = false;
    }
  }

  const base =
    "relative inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-medium shadow-card transition disabled:cursor-not-allowed";
  const look =
    variant === "primary"
      ? "bg-accent-500 text-accent-ink hover:bg-accent-600 disabled:opacity-70"
      : "border border-line bg-surface text-ink-2 hover:border-accent-300 disabled:opacity-60";

  return (
    <button
      type={type}
      onClick={handle}
      disabled={busy || disabled}
      // Read out by a screen reader the moment it flips, so the state is not
      // only conveyed by a spinning shape.
      aria-busy={busy}
      className={`${base} ${look} ${className}`}
    >
      {busy && <Spinner />}
      <span>{busy ? (busyLabel ?? `${textOf(children)}…`) : children}</span>
    </button>
  );
}

/**
 * The spinner itself.
 *
 * currentColor, so it works on the accent fill and on the pale secondary
 * button without either one needing to know about it.
 */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A row of text with a spinner, for waits that are not a button. */
export function BusyNote({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-ink-3">
      <Spinner className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

/** Best effort at the label, so the fallback busy text reads sensibly. */
function textOf(children: React.ReactNode): string {
  return typeof children === "string" ? children : "Working";
}
