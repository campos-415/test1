"use client";

import { useSettings } from "@/components/SettingsProvider";
import { BusinessInfo, getBusiness } from "@/lib/business";

// Business details that re-render when the settings row arrives.
//
// getBusiness() reads a module cache, which is enough for a one-off render
// but will not update on its own. Subscribing to the settings context here
// is what makes a phone number changed on /settings appear on the website
// without a reload.
export function useBusiness(): BusinessInfo {
  useSettings();
  return getBusiness();
}
