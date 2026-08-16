"use client";

import { ChangeEvent, useCallback, useEffect, useState } from "react";
import { uploadSiteImage } from "@/lib/siteStorage";
import {
  SitePhoto,
  addSitePhoto,
  deleteSitePhoto,
  loadSitePhotos,
  reorderSitePhotos,
  updateSitePhoto,
} from "@/lib/sitePhotos";

// Manages the public gallery from /settings.
//
// Saves immediately rather than joining the page's draft-and-save flow:
// these are separate rows, not part of the settings blob, and an upload is
// already a deliberate action. Nothing here is affected by the Save button
// at the top of the page.
export default function GalleryEditor() {
  const [photos, setPhotos] = useState<SitePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setPhotos(await loadSitePhotos("gallery"));
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        // 1400px wide is plenty for a grid tile on a retina screen, and
        // keeps a nine-photo gallery to a sensible total weight.
        const data = await uploadSiteImage(file, "gallery", 1400, 300 * 1024);
        await addSitePhoto(data, "");
      }
      await refresh();
    } catch (err) {
      console.error("Uploading gallery photo failed:", err);
      setError("Could not save one of those images — try a smaller file.");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, delta: number) {
    const next = [...photos];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next); // optimistic; the order is the whole point of the click
    try {
      await reorderSitePhotos(next.map((p) => p.id!).filter(Boolean));
    } catch (err) {
      console.error("Reordering failed:", err);
      setError("Could not save the new order.");
      refresh();
    }
  }

  async function remove(photo: SitePhoto) {
    if (!photo.id) return;
    if (!window.confirm("Remove this photo from the website gallery?")) return;
    try {
      await deleteSitePhoto(photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) {
      console.error("Deleting photo failed:", err);
      setError("Could not remove that photo.");
    }
  }

  async function saveAlt(photo: SitePhoto, alt: string) {
    if (!photo.id || alt === (photo.alt ?? "")) return;
    try {
      await updateSitePhoto(photo.id, { alt: alt.trim() || null });
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, alt } : p)));
    } catch (err) {
      console.error("Saving description failed:", err);
      setError("Could not save that description.");
    }
  }

  return (
    <div>
      {photos.length === 0 && !loading && (
        <p className="mb-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          No photos uploaded yet, so the gallery is showing stock placeholder images. Upload your
          own and they replace them straight away.
        </p>
      )}

      {error && <p className="mb-3 text-xs font-medium text-rose-500">{error}</p>}

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, i) => (
            <div key={photo.id} className="rounded-2xl border border-line-soft p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.data}
                alt={photo.alt ?? ""}
                className="aspect-[4/3] w-full rounded-xl object-cover"
              />
              <input
                defaultValue={photo.alt ?? ""}
                onBlur={(e) => saveAlt(photo, e.target.value)}
                placeholder="Describe this photo"
                className="mt-2 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent-500"
              />
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Move earlier"
                  className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 disabled:opacity-30"
                >
                  ←
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === photos.length - 1}
                  title="Move later"
                  className="rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 disabled:opacity-30"
                >
                  →
                </button>
                <span className="text-[10px] text-ink-3">#{i + 1}</span>
                <button
                  onClick={() => remove(photo)}
                  className="ml-auto text-[11px] text-rose-400 hover:text-rose-600"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink-2 transition hover:border-accent-400">
          {busy ? "Uploading…" : "+ Add photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={upload}
            disabled={busy}
          />
        </label>
        <p className="text-[11px] text-ink-3">
          Saved as you go — the Save button above is only for the settings around it. Images are
          resized on upload. The description is what a screen reader reads aloud and what search
          engines index, so it is worth filling in.
        </p>
      </div>
    </div>
  );
}
