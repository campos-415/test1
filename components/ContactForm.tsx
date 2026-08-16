"use client";

import { useState } from "react";
import { useBusiness } from "@/components/useBusiness";

export default function ContactForm() {
  const BUSINESS = useBusiness();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [dogName, setDogName] = useState("");
  const [message, setMessage] = useState("");

  const subject = encodeURIComponent(`New inquiry from ${name || "the website"}`);
  const body = encodeURIComponent(
    `Name: ${name}\nEmail: ${email}\nDog's name: ${dogName}\n\n${message}`
  );
  const mailtoHref = `mailto:${BUSINESS.email}?subject=${subject}&body=${body}`;

  return (
    <form
      className="space-y-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-card sm:p-8"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Your name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
            placeholder="jane@email.com"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">Dog's name</label>
        <input
          value={dogName}
          onChange={(e) => setDogName(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          placeholder="Luna"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-500">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
          placeholder="Tell us a bit about your dog and what you're looking for..."
        />
      </div>
      <a
        href={mailtoHref}
        className="inline-block rounded-full bg-accent-500 px-6 py-3 text-sm font-semibold text-accent-ink shadow-card transition hover:bg-accent-600"
      >
        Send Message
      </a>
      <p className="text-xs text-slate-400">
        This opens your email app with the message pre-filled. Prefer to call or text?
        Reach us at {BUSINESS.phone}.
      </p>
    </form>
  );
}
