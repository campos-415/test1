// Customer reviews shown on the marketing site.
//
// These used to be a hardcoded array here, which meant a redeploy to change
// a quote. They now live in the settings row alongside prices and opening
// hours, so staff edit them under Settings → Website.
//
// Keep them genuine — copy them from the business's real listing rather than
// writing new ones. Invented reviews are a legal problem in the US, and an
// editable box makes them easy to invent by accident.

import { getSettings } from "@/lib/settings";
import type { ReviewItem } from "@/lib/settings";

export type { ReviewItem };

/**
 * Read through getters, the same way PRICING is, so call sites keep working
 * and every read picks up whatever settings currently hold.
 *
 * On the server this returns the shipped defaults — settings are loaded in
 * the browser. Anything that must show the saved values renders on the
 * client; see components/Reviews.tsx.
 */
export const REVIEWS: ReviewItem[] = new Proxy([] as ReviewItem[], {
  get(_t, prop, receiver) {
    return Reflect.get(getSettings().reviews.items, prop, receiver);
  },
  has: (_t, prop) => prop in getSettings().reviews.items,
  ownKeys: () => Reflect.ownKeys(getSettings().reviews.items),
  getOwnPropertyDescriptor: (_t, prop) =>
    Reflect.getOwnPropertyDescriptor(getSettings().reviews.items, prop),
});

export const REVIEW_SUMMARY = {
  get average() {
    const items = getSettings().reviews.items;
    if (!items.length) return 0;
    return items.reduce((sum, r) => sum + (r.rating || 0), 0) / items.length;
  },
  get count() {
    return getSettings().reviews.items.length;
  },
  get source() {
    return getSettings().reviews.source;
  },
};
