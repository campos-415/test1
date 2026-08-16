"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import BoardingRequestForm from "@/components/BoardingRequestForm";
import { useSettings } from "@/components/SettingsProvider";

// The public boarding request form — the second URL a business puts on
// their website, alongside /enroll.
//
// /book?embed=1 strips the heading for use inside an <iframe>, same as the
// enrollment form.
export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <PublicBook />
    </Suspense>
  );
}

function PublicBook() {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";
  const { settings } = useSettings();

  if (embed) {
    return (
      <div className="bg-transparent">
        <BoardingRequestForm source="web" embed />
      </div>
    );
  }

  return (
    <div>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-5 py-5 sm:px-8">
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
            <p className="text-xs text-ink-3">Boarding request</p>
          </div>
        </div>
      </header>
      <BoardingRequestForm source="web" />
    </div>
  );
}
