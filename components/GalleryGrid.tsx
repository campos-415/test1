"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PLACEHOLDER_GALLERY, SitePhoto, loadSitePhotos } from "@/lib/sitePhotos";

// The gallery, from whatever the business has uploaded on /settings.
//
// Falls back to the stock placeholders while loading and when nothing has
// been uploaded — an empty grid reads as a broken page rather than an
// unfinished one.
export default function GalleryGrid() {
  const [photos, setPhotos] = useState<SitePhoto[] | null>(null);

  useEffect(() => {
    loadSitePhotos("gallery").then(setPhotos);
  }, []);

  const items =
    photos && photos.length
      ? photos.map((p) => ({ data: p.data, alt: p.alt ?? "" }))
      : PLACEHOLDER_GALLERY;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((photo, i) => (
        <div
          key={`${photo.data.slice(0, 40)}-${i}`}
          className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-card"
        >
          {/* Uploaded photos are data URLs, which next/image cannot
              optimise, so those render as a plain img. Remote placeholders
              still go through next/image. */}
          {photo.data.startsWith("data:") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo.data} alt={photo.alt} className="h-full w-full object-cover" />
          ) : (
            <Image
              src={photo.data}
              alt={photo.alt}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Whether the page is still showing stock photos, for the caption below. */
export function useUsingPlaceholders(): boolean {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    loadSitePhotos("gallery").then((p) => setCount(p.length));
  }, []);
  return count === 0;
}
