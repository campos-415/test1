"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "are you sure, and why?" step before turning a request down.
 *
 * This was a window.prompt(). Three problems with that, in the order they
 * bite: not every browser supports it — an embedded one can throw on the call,
 * which took the whole page down with an unhandled error instead of declining
 * anything; Chrome offers to suppress further dialogs after a couple of them,
 * and a suppressed prompt returns null, which this code read as "cancelled";
 * and a system dialog on a phone covers the row being declined, so whoever is
 * typing the note can no longer see whose enrollment it is.
 *
 * An inline panel has none of that and can say who is being declined while the
 * note is being written.
 */
export default function DeclineNote({
  title,
  hint,
  busy,
  confirmLabel = "Decline",
  onConfirm,
  onCancel,
}: {
  title: string;
  hint?: string;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  // Opening this is already the decision to decline; the cursor belongs in the
  // note without a second tap.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="border-t border-line-soft bg-rose-50/40 p-4">
      <p className="text-sm font-medium text-ink">{title}</p>
      <label className="mt-3 block text-[11px] text-ink-3" htmlFor="decline-note">
        Note (optional, staff only)
      </label>
      <input
        id="decline-note"
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm(note);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Why it was turned down — the client never sees this"
        className="mt-1 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => onConfirm(note)}
          disabled={busy}
          className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-rose-600 disabled:opacity-60"
        >
          {busy ? "Declining…" : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink-2 hover:border-line disabled:opacity-60"
        >
          Cancel
        </button>
        {hint && <p className="text-[11px] text-ink-3">{hint}</p>}
      </div>
    </div>
  );
}
