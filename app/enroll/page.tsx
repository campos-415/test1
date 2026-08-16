"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import EnrollmentForm from "@/components/EnrollmentForm";
import { useSettings } from "@/components/SettingsProvider";

// The public enrollment form — the URL a business puts on their own website.
//
// Two ways to use it: link straight to /enroll, or drop /enroll?embed=1 into
// an iframe on their site. Embed mode strips the heading and the back link
// so it sits inside a page that already has its own header, and keeps the
// background transparent so it inherits the host page's.
export default function EnrollPage() {
  return (
    <Suspense fallback={null}>
      <PublicEnroll />
    </Suspense>
  );
}

function PublicEnroll() {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";
  const { settings } = useSettings();

  if (embed) {
    return (
      <div className="bg-transparent">
        <EnrollmentForm source="web" embed />
      </div>
    );
  }

  return (
    <div>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-5 sm:px-8">
          {settings.business.logoData && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.business.logoData}
              alt={settings.business.name}
              className="h-10 w-auto object-contain"
            />
          )}
          <div>
            <p className="font-display text-lg font-semibold text-ink">{settings.business.name}</p>
            <p className="text-xs text-ink-3">New client enrollment</p>
          </div>
        </div>
      </header>
      <EnrollmentForm source="web" />
    </div>
  );
}
