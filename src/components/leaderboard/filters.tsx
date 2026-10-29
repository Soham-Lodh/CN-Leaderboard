"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "../ui";
import type { PublicDomain } from "@/lib/services/leaderboard";

/**
 * Two untrusted sources drive the same URL querystring: the search
 * input and the domain chips. Server State (the URL) owns the truth;
 * the server re-renders the list from freshly validated params.
 */
export function LeaderboardFilters({ domains }: { domains: PublicDomain[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selected = new Set((params.get("domains") ?? "").split(",").filter(Boolean));
  const urlQuery = params.get("q") ?? "";
  const [inputValue, setInputValue] = useState(urlQuery);
  const [domainSearch, setDomainSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(urlQuery);
  }, [urlQuery]);

  const push = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mutate(next);
      next.delete("page");
      startTransition(() => {
        router.replace(`/leaderboard${next.size > 0 ? `?${next}` : ""}`, { scroll: false });
      });
    },
    [params, router],
  );

  const onSearch = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      push((next) => {
        if (value.trim()) next.set("q", value.trim());
        else next.delete("q");
      });
    }, 300);
  };

  const toggleDomain = (slug: string) => {
    push((next) => {
      const set = new Set(selected);
      if (set.has(slug)) set.delete(slug);
      else set.add(slug);
      // Selecting nothing means "every domain" (the default view).
      if (set.size > 0 && set.size < domains.length) next.set("domains", [...set].join(","));
      else next.delete("domains");
    });
  };

  const everyDomain = selected.size === 0 || selected.size === domains.length;
  const visibleDomains = domains.filter((d) => d.name.toLowerCase().includes(domainSearch.trim().toLowerCase()));
  const chips = visibleDomains.map((d) => {
    const on = everyDomain || selected.has(d.slug);
    return (
      <button
        key={d.id}
        type="button"
        aria-pressed={on}
        onClick={() => toggleDomain(d.slug)}
        className={cn(
          "min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors",
          on ? "border-accent bg-accent-soft text-accent-dark" : "border-line bg-white text-muted hover:bg-surface",
        )}
      >
        {d.name}
      </button>
    );
  });

  return (
    <section aria-label="Leaderboard filters" className="space-y-4">
      <div>
        <label htmlFor="leaderboard-search" className="mb-1.5 block text-sm font-medium">
          Search name or roll number
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">
            <Search size={16} aria-hidden="true" />
          </span>
          <input
            id="leaderboard-search"
            type="search"
            value={inputValue}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="e.g. Riya or 2105234"
            className="w-full rounded-lg border border-line bg-white py-2.5 pl-9 pr-9 text-sm outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {inputValue ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute inset-y-0 right-1 flex items-center px-2 text-faint hover:text-ink"
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">
          Domains {everyDomain ? <span className="font-normal text-muted">(all selected)</span> : null}
        </legend>
        <label htmlFor="domain-search" className="sr-only">Search domains</label>
        <input
          id="domain-search"
          type="search"
          value={domainSearch}
          onChange={(e) => setDomainSearch(e.target.value)}
          placeholder="Search domains"
          className="mb-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex flex-wrap gap-2" aria-busy={isPending}>
          {chips}
        </div>
      </fieldset>
    </section>
  );
}
