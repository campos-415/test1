// Photos the business uploads for the public website.
//
// Kept out of the settings row on purpose — settings are read by every page
// including the kiosk, and photos are read by one. See
// site-photos-migration.sql.

import { getSupabase } from "@/lib/supabase";

export interface TeamMeta {
  name?: string;
  role?: string;
  bio?: string;
}

export interface SitePhoto {
  id?: string;
  // "gallery" | "hero" | "about" | "team" — see the editors on /settings.
  kind: string;
  alt: string | null;
  data: string; // data URL
  sort_order: number;
  // Fields only some placements need. Team cards carry name/role/bio here.
  meta?: TeamMeta | null;
  created_at?: string;
}

/** The single photo for a one-image placement, or null to use the stock one. */
export async function loadSinglePhoto(kind: string): Promise<SitePhoto | null> {
  const rows = await loadSitePhotos(kind);
  return rows[0] ?? null;
}

/**
 * Placeholders shown until a business uploads its own. A brand-new install
 * showing an empty page would look broken rather than unconfigured, and
 * these are the stock photos the site shipped with.
 */
export const PLACEHOLDER_GALLERY: { data: string; alt: string }[] = [
  ["photo-1643213641079-1e60ef170910", "Dogs playing together at daycare"],
  ["photo-1534361960057-19889db9621e", "Dog relaxing indoors"],
  ["photo-1546447147-3fc2b8181a74", "Dog resting during boarding stay"],
  ["photo-1595886578982-a9de564a984e", "Dog on a comfortable bed"],
  ["photo-1560743641-3914f2c45636", "Dog getting a bath"],
  ["photo-1608363789080-2d1f019445fa", "Dog freshly groomed"],
  ["photo-1601758176481-e81a6b713126", "Dog on a walk outdoors"],
  ["photo-1618307987789-79e5930f902e", "Dog boarding in a cozy shared space"],
  ["photo-1575859430826-11e623dd2394", "Dog enjoying overnight boarding"],
].map(([id, alt]) => ({
  data: `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`,
  alt,
}));

/** Replaces the single photo held for a one-image placement. */
export async function setSinglePhoto(kind: string, data: string, alt: string): Promise<void> {
  const supabase = getSupabase();
  // Delete-then-insert rather than update: there may be none yet, and this
  // also cleans up if an earlier run somehow left two.
  const { error: delErr } = await supabase.from("site_photos").delete().eq("kind", kind);
  if (delErr) throw delErr;
  await addSitePhoto(data, alt, kind);
}

export async function clearSinglePhoto(kind: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("site_photos").delete().eq("kind", kind);
  if (error) throw error;
}

export const PLACEHOLDER_HERO =
  "https://images.unsplash.com/photo-1592817797597-392e3b878e1c?auto=format&fit=crop&w=1200&q=80";

export const PLACEHOLDER_ABOUT =
  "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=1200&q=80";

export async function loadSitePhotos(kind = "gallery"): Promise<SitePhoto[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("site_photos")
      .select("*")
      .eq("kind", kind)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as SitePhoto[]) ?? [];
  } catch (e) {
    // A missing table (migration not run) should leave the website showing
    // its placeholders, not an error.
    console.error("Loading site photos failed:", e);
    return [];
  }
}

export async function addSitePhoto(
  data: string,
  alt: string,
  kind = "gallery",
  meta: TeamMeta = {}
): Promise<SitePhoto> {
  const supabase = getSupabase();
  // Append: one past the highest existing position.
  const { data: last } = await supabase
    .from("site_photos")
    .select("sort_order")
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1);
  const next = ((last as { sort_order: number }[] | null)?.[0]?.sort_order ?? -1) + 1;

  const { data: row, error } = await supabase
    .from("site_photos")
    .insert({ kind, data, alt: alt.trim() || null, sort_order: next, meta })
    .select("*")
    .single();
  if (error) throw error;
  return row as SitePhoto;
}

export async function updateSitePhoto(id: string, patch: Partial<SitePhoto>): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("site_photos").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteSitePhoto(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("site_photos").delete().eq("id", id);
  if (error) throw error;
}

/** Writes the given order back as 0..n-1. */
export async function reorderSitePhotos(ids: string[]): Promise<void> {
  const supabase = getSupabase();
  await Promise.all(
    ids.map((id, i) => supabase.from("site_photos").update({ sort_order: i }).eq("id", id))
  );
}
