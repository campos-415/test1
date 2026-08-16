"use client";

// Website images as files, not as rows.
//
// Everything else in this app stores images as base64 inside the database
// row, which is a reasonable trade for a dog's photo: it is private, it is
// read by a handful of staff, and it never needs a CDN.
//
// The website's images are the opposite on every count. They are public, few,
// changed rarely, and looked at by everyone — and served from a row they came
// back through the database API on every single page load, uncached, because
// the Supabase client sends `cache: no-store` (it has to, for live data like
// sign-ins). A returning visitor re-downloaded the whole gallery every time.
//
// As files in a public bucket they are fetched once, cached by the browser,
// and served from a CDN. Repeat visits cost nothing.
//
// What does NOT move: dog photos, signed waivers and vaccination records.
// Those are customer data, and a public bucket makes the URL the only thing
// standing between a stranger and someone's paperwork.

import { getSupabase } from "@/lib/supabase";
import { fileToBudgetedJpeg } from "@/lib/image";

const BUCKET = "site-photos";

/** A data URL as a Blob, so it can be uploaded rather than stored as text. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** True for something this module uploaded, as opposed to a data URL or a bundled file. */
export function isStoredImage(value: string | null | undefined): boolean {
  return !!value && value.includes(`/storage/v1/object/public/${BUCKET}/`);
}

/**
 * Which half of the job failed.
 *
 * Worth the type, because the two need opposite responses and the screens
 * used to report both as "could not read that image — try a different file".
 * A refused upload has nothing to do with the file: on a database where
 * site-storage-migration.sql has not been run there are no policies on
 * storage.objects, so every upload is denied and the person at the keyboard
 * tries five perfectly good images before giving up.
 */
export class SiteImageError extends Error {
  constructor(
    readonly kind: "decode" | "upload",
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "SiteImageError";
  }
}

/**
 * Compresses, uploads, and returns the public URL to store instead of the
 * image itself.
 *
 * Still budgeted: a CDN makes repeat views free, not the first one, and the
 * first one is on a phone in a car park.
 */
export async function uploadSiteImage(
  file: File,
  folder: string,
  maxDim: number,
  targetBytes: number
): Promise<string> {
  let dataUrl: string;
  try {
    dataUrl = await fileToBudgetedJpeg(file, maxDim, targetBytes);
  } catch (e) {
    // Genuinely the file: an SVG the browser will not draw, a HEIC straight
    // off a phone, something that is not an image at all.
    throw new SiteImageError("decode", "That file could not be read as an image.", e);
  }

  const supabase = getSupabase();
  // Random name, so replacing an image can never be served from a stale cache
  // under the name the old one had.
  const path = `${folder}/${crypto.randomUUID()}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, dataUrlToBlob(dataUrl), {
    contentType: "image/jpeg",
    upsert: false,
    // Cache for a year. Safe precisely because the name is random: the bytes
    // at a given URL never change, so there is nothing to go stale. Replacing
    // an image writes a new name, and the page points at that instead.
    // Without this the default is no-cache, which still saves the download but
    // costs a revalidation round trip per image per page view.
    cacheControl: "31536000",
  });
  if (error) {
    console.error("Uploading to the site-photos bucket failed:", error);
    throw new SiteImageError(
      "upload",
      "The image was fine, but storage refused to save it.",
      error
    );
  }

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Removes an image this module uploaded. Anything else — a data URL from
 * before the move, or a file bundled with the app — is left alone.
 *
 * Failure is deliberately swallowed: an orphaned file is untidy, and losing
 * the replacement because the tidying failed would be worse.
 */
export async function deleteSiteImage(url: string | null | undefined): Promise<void> {
  if (!isStoredImage(url)) return;
  try {
    const path = url!.split(`/storage/v1/object/public/${BUCKET}/`)[1];
    if (!path) return;
    await getSupabase().storage.from(BUCKET).remove([decodeURIComponent(path)]);
  } catch (e) {
    console.error("Could not remove the old image:", e);
  }
}
