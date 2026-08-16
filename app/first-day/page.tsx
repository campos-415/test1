"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StaffGate from "@/components/StaffGate";
import StaffNav from "@/components/StaffNav";
import FirstDaySheet, { EMPTY_REPORT, FirstDayReport } from "@/components/FirstDaySheet";
import { useSettings } from "@/components/SettingsProvider";
import { getSupabase } from "@/lib/supabase";
import { printNode } from "@/lib/printNode";
import { Dog, Owner } from "@/types";

// "My first day" — the thing a household takes home from a meet & greet.
//
// It is printed rather than emailed on purpose. The meet & greet ends with
// the owner standing at the desk, and a sheet with their dog's photo on it
// handed over at that moment is worth more than a message they read that
// evening. It is also the first thing the business gives them that is about
// their dog rather than about paperwork.
//
// The fields are filled in on screen and printed. They are deliberately NOT
// stored: there is no table for them, and inventing one to hold a document
// whose whole purpose is to be handed over would be storing it for us rather
// than for them.
//
// The sheet itself lives in components/FirstDaySheet so it can be rendered
// and checked without a staff sign-in.
export default function FirstDayPage() {
  return (
    <StaffGate title="First day report">
      <FirstDay />
    </StaffGate>
  );
}

function FirstDay() {
  const { settings } = useSettings();

  // The dog id is read off the URL directly rather than with
  // useSearchParams, and that is the fix for the page printing blank.
  //
  // useSearchParams makes a component suspend, so it has to sit inside a
  // Suspense boundary — and this one had fallback={null}. Anything that
  // makes the tree suspend again therefore renders NOTHING rather than the
  // sheet, which is exactly what a blank page is. A print is not the place
  // to discover that your fallback is empty.
  //
  // Nothing here needs to react to the query string changing: the report is
  // opened in a new tab for one dog and stays on that dog.
  // null means "not read yet", which is not the same as "no dog on the
  // link" — without that distinction the first render reports a missing dog
  // before the URL has been looked at.
  const [dogId, setDogId] = useState<string | null>(null);
  useEffect(() => {
    setDogId(new URLSearchParams(window.location.search).get("dog") ?? "");
  }, []);

  const [dog, setDog] = useState<Dog | null>(null);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [report, setReport] = useState<FirstDayReport>(EMPTY_REPORT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sheetRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (dogId === null) return; // URL not read yet
    if (!dogId) {
      setError("No dog on the link.");
      setLoading(false);
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error: err } = await supabase
        .from("dogs")
        .select("*")
        .eq("id", dogId)
        .maybeSingle();
      if (err) throw err;
      const found = (data as Dog | null) ?? null;
      setDog(found);
      if (found?.phone) {
        const { data: o } = await supabase
          .from("owners")
          .select("*")
          .eq("phone", found.phone)
          .maybeSingle();
        setOwner((o as Owner | null) ?? null);
      }
    } catch (e) {
      console.error("Loading the first-day report failed:", e);
      setError("Could not load that dog.");
    } finally {
      setLoading(false);
    }
  }, [dogId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="px-5 py-10 text-sm text-ink-3">Loading…</p>;
  if (error || !dog) {
    return <p className="px-5 py-10 text-sm text-rose-600">{error || "No dog found."}</p>;
  }

  return (
    <div>
      <div className="print:hidden">
        {/* Opened from the sign-in list and belongs to it, so that is the tab
            that stays lit. */}
        <StaffNav current="/in-house" />
      </div>

      <div className="mx-auto max-w-2xl px-5 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
          <h1 className="font-display text-xl font-semibold text-ink">
            First day report — {dog.dog_name}
          </h1>
          <button
            onClick={() => {
              const node = sheetRef.current?.firstElementChild as HTMLElement | null;
              if (node) printNode(node, `First day — ${dog.dog_name}`);
            }}
            className="ml-auto rounded-xl bg-accent-500 px-5 py-2 text-sm font-medium text-accent-ink shadow-card transition hover:bg-accent-600"
          >
            🖨 Print for the owner
          </button>
        </div>
        <p className="mb-4 text-xs text-ink-3 print:hidden">
          Fill this in and print it. It is not saved — it is the copy the household takes home.
        </p>

        <div ref={sheetRef}>
          <FirstDaySheet
          dog={dog}
          owner={owner}
          report={report}
          onChange={setReport}
          businessName={settings.business.name}
            businessPhone={settings.business.phone}
          />
        </div>
      </div>
    </div>
  );
}
