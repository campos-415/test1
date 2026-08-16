"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { dogHref } from "@/lib/dogs";
import { Dog } from "@/types";
import { isRetired } from "@/lib/retire";

// Type-ahead over every dog on file. Matches the dog's name or the owner
// surname, so "Martinez" finds the household as readily as "Bella" finds
// the dog. Picking a result opens that dog's profile.
export default function DogSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Dog[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const supabase = getSupabase();
        // Escape PostgREST's or() separators so a stray comma or paren in
        // the query can't break out of the filter expression.
        const safe = q.replace(/[,()]/g, " ").trim();
        const { data, error } = await supabase
          .from("dogs")
          .select("*")
          .or(`dog_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
          .order("dog_name", { ascending: true })
          .limit(12);
        if (error) throw error;
        setResults((data as Dog[]) ?? []);
        setHighlight(0);
        setOpen(true);
      } catch (e) {
        console.error("Dog search failed:", e);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [query]);

  // Clicking anywhere else dismisses the dropdown.
  useEffect(() => {
    function onClickAway(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickAway);
    return () => document.removeEventListener("mousedown", onClickAway);
  }, []);

  function go(dog: Dog) {
    if (!dog.id) return;
    setOpen(false);
    setQuery("");
    router.push(dogHref(dog.id));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder="🔍 Search a dog by name or owner…"
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none transition focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
      />

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-2xl border border-line bg-surface py-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-3">
              {searching ? "Searching…" : `No dog matches "${query.trim()}".`}
            </p>
          ) : (
            results.map((c, i) => (
              <button
                key={c.id}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(c)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition ${
                  i === highlight ? "bg-accent-50" : "hover:bg-surface-2"
                }`}
              >
                {c.photo_data ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo_data} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-base">
                    🐕
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {c.dog_name}
                    {/* Search is a lookup, not a booking screen, so retired
                        dogs are still findable — their history is often the
                        reason somebody is searching. Marked, so nobody walks
                        from here into a sign-in expecting to find them. */}
                    {isRetired(c) && (
                      <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
                        Retired
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {c.last_name} · {c.phone}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
