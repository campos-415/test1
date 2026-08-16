"use client";

import { useState } from "react";

// An uploaded vaccination record, shown where staff are already looking.
//
// This existed as a link straight to the file's data: URL, which produced a
// blank tab: browsers have blocked top-level navigation to data: URLs since
// 2017 as an anti-phishing measure, and a blocked navigation looks exactly
// like a broken link. Two consequences shape this component:
//
//   * an image is rendered inline instead. Somebody approving an enrollment
//     needs to read an expiry date off a vaccination card — sending them to
//     another tab to do it was the wrong shape even when it worked.
//   * anything that does need its own tab (a PDF) goes through a blob: URL,
//     which is permitted. Downloads are fine either way, because the
//     `download` attribute is not a navigation.

function isImage(mime: string, data: string): boolean {
  return mime.startsWith("image/") || data.startsWith("data:image/");
}

export default function RecordPreview({
  name,
  mime,
  data,
  label = "Uploaded records",
}: {
  name: string;
  mime: string;
  data: string;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  async function openInTab() {
    try {
      // Round-tripping through a blob is what makes this openable at all.
      const blob = await (await fetch(data)).blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error("Opening the record failed:", e);
      setError("Could not open that file.");
    }
  }

  const image = isImage(mime, data);

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          📎 {label}
        </span>
        <span className="min-w-0 truncate text-[11px] text-ink-3">{name}</span>
        {image && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium text-accent-600 hover:underline"
          >
            {expanded ? "Shrink" : "Enlarge"}
          </button>
        )}
        <button onClick={openInTab} className="text-xs font-medium text-accent-600 hover:underline">
          Open in a tab
        </button>
        <a
          href={data}
          download={name}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Download
        </a>
      </div>

      {image ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Click to shrink" : "Click to enlarge"}
          className="mt-1.5 block w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-surface-2 p-1 text-left"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data}
            alt={`Vaccination record: ${name}`}
            className={`mx-auto rounded-lg object-contain ${
              expanded ? "max-h-[80vh] w-auto" : "max-h-56 w-auto"
            }`}
          />
        </button>
      ) : (
        <p className="mt-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
          {mime === "application/pdf" || data.startsWith("data:application/pdf")
            ? "PDF — use “Open in a tab” to read it."
            : "This file cannot be previewed here. Use “Open in a tab” or download it."}
        </p>
      )}

      {error && <p className="mt-1 text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}
