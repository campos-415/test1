"use client";

import { useEffect, useState } from "react";

// A collapsible card.
//
// The profile pages had nine sections open at once, every field an input,
// and the page ran to several screens before you reached the visit history.
// Staff read a profile far more often than they edit one, so sections start
// closed and carry a one-line summary in the header — the answer is visible
// without opening anything, and opening is for changing it.
//
// Open/closed is remembered per section, per device: someone who always
// wants Vaccines open should get it open tomorrow too.
export default function Panel({
  id,
  title,
  summary,
  count,
  blurb,
  tone = "default",
  defaultOpen = false,
  children,
}: {
  /** Stable key for remembering the open state. */
  id: string;
  title: string;
  /** Shown in the header — the gist, so the section need not be opened. */
  summary?: string;
  count?: number;
  /** Explanatory line shown inside the panel, above its content. */
  blurb?: string;
  /** "alert" tints the header when the summary is something to act on. */
  tone?: "default" | "alert";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const key = `panel:${id}`;
  const [open, setOpen] = useState(defaultOpen);
  // Read after mount: localStorage does not exist during the server render,
  // and reading it in useState would make the markup mismatch on hydration.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    if (stored === "open") setOpen(true);
    else if (stored === "closed") setOpen(false);
    setReady(true);
  }, [key]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(key, next ? "open" : "closed");
      } catch {
        // Private browsing, or storage full. The panel still works.
      }
      return next;
    });
  }

  return (
    <section className="mb-3 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <button
        onClick={toggle}
        aria-expanded={open}
        className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-surface-2 ${
          tone === "alert" ? "bg-amber-50/60" : ""
        }`}
      >
        <span
          className={`shrink-0 text-[11px] text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▶
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {title}
          {count != null && <span className="ml-1.5 font-normal">({count})</span>}
        </span>
        {/* The summary is the point of collapsing: it answers the question
            most of the time, so the section stays shut. */}
        {!open && summary && (
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              tone === "alert" ? "font-medium text-amber-800" : "text-ink-3"
            }`}
          >
            {summary}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[11px] font-medium text-accent-600">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {/* `ready` avoids a flash of the wrong state before storage is read. */}
      {open && ready && (
        <div className="border-t border-line-soft px-5 py-4">
          {blurb && <p className="mb-3 text-[11px] text-ink-3">{blurb}</p>}
          {children}
        </div>
      )}
    </section>
  );
}

// A read-only row for summarising an answer without opening the editor.
export function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="w-44 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 text-ink-2">{value || <span className="text-ink-3">—</span>}</span>
    </div>
  );
}
