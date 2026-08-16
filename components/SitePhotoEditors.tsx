"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { uploadSiteImage } from "@/lib/siteStorage";
import {
  PLACEHOLDER_ABOUT,
  PLACEHOLDER_HERO,
  SitePhoto,
  clearSinglePhoto,
  loadSinglePhoto,
  setSinglePhoto,
  updateSitePhoto,
} from "@/lib/sitePhotos";

// Editors for the one-off photo spots. Like the gallery editor, these save
// immediately — they are their own rows, not part of the settings blob the
// Save button writes.
//
// The team used to be edited here too, as photos carrying a name, role and
// bio. It moved to Settings → Content, next to the rest of the About page,
// because having half a team member here and half there meant an edit landed
// in whichever of the two you happened to open.

export function SinglePhotoEditor({
  kind,
  label,
  hint,
}: {
  kind: "hero" | "about";
  label: string;
  hint: string;
}) {
  const [photo, setPhoto] = useState<SitePhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setPhoto(await loadSinglePhoto(kind));
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      // Wider than a gallery tile — this one runs half the screen.
      const data = await uploadSiteImage(file, "hero", 1600, 400 * 1024);
      await setSinglePhoto(kind, data, photo?.alt ?? "");
      await refresh();
    } catch (err) {
      console.error("Uploading photo failed:", err);
      setError("Could not save that image — try a smaller file.");
    } finally {
      setBusy(false);
    }
  }

  const src = photo?.data ?? (kind === "hero" ? PLACEHOLDER_HERO : PLACEHOLDER_ABOUT);

  return (
    <div className="rounded-xl border border-line-soft p-3.5">
      <p className="text-sm font-medium text-ink-2">{label}</p>
      <p className="mb-2 text-[11px] text-ink-3">{hint}</p>
      {loading ? (
        <p className="text-xs text-ink-3">Loading…</p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="aspect-[4/3] w-full max-w-xs rounded-xl object-cover" />
          {!photo && (
            <p className="mt-1.5 text-[11px] text-amber-700">Stock photo — upload one to replace it.</p>
          )}
          <input
            defaultValue={photo?.alt ?? ""}
            onBlur={(e) =>
              photo?.id && updateSitePhoto(photo.id, { alt: e.target.value.trim() || null })
            }
            placeholder="Describe this photo"
            disabled={!photo}
            className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent-500 disabled:opacity-50"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="cursor-pointer rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink-2 transition hover:border-accent-400">
              {busy ? "Uploading…" : photo ? "Replace" : "Upload"}
              <input type="file" accept="image/*" className="hidden" onChange={upload} disabled={busy} />
            </label>
            {photo && (
              <button
                onClick={async () => {
                  await clearSinglePhoto(kind);
                  refresh();
                }}
                className="text-[11px] text-rose-400 hover:text-rose-600"
              >
                Remove (back to stock)
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs font-medium text-rose-500">{error}</p>}
    </div>
  );
}

