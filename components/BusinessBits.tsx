"use client";

import { useBusiness } from "@/components/useBusiness";

// Small pieces of the website that show live business details.
//
// The pages these sit on are server components, because they export SEO
// metadata. These are the parts carved out as client components so the
// address, hours and phone number follow /settings instead of being frozen
// into the build.

export function AddressPill() {
  const b = useBusiness();
  return (
    <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-50 px-3.5 py-1.5 text-sm font-semibold text-accent-700">
      🐾 {b.address.street}, {b.address.city}
    </p>
  );
}

export function HoursLine() {
  const b = useBusiness();
  return (
    <p className="mt-6 text-sm text-slate-500">
      {b.hours.daycare}
      <br />
      {b.hours.weekend}&nbsp;·&nbsp;{" "}
      <a href={b.phoneHref} className="font-medium text-accent-600">
        {b.phone}
      </a>
    </p>
  );
}

// The four cards down the side of the contact page.
export function ContactCards() {
  const b = useBusiness();
  return (
    <div className="space-y-6 lg:col-span-2">
      <Card title="Visit">
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {b.address.street}
          <br />
          {b.address.city}, {b.address.state} {b.address.zip}
        </p>
      </Card>
      <Card title="Call or Text">
        <a href={b.phoneHref} className="mt-2 block text-sm font-medium text-accent-600">
          {b.phone}
        </a>
      </Card>
      <Card title="Email">
        <a
          href={`mailto:${b.email}`}
          className="mt-2 block break-words text-sm font-medium text-accent-600"
        >
          {b.email}
        </a>
      </Card>
      <Card title="Hours">
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {b.hours.daycare}
          <br />
          {b.hours.weekend}
          <br />
          Boarding: {b.hours.boarding}
        </p>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-card">
      <h3 className="font-display text-base font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}
