"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { SearchResult } from "../../services/searchService";
import styles from "./GlobalSearch.module.css";

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  project: "Project",
  challan: "Challan",
  bill: "Running Bill",
  payment: "Payment",
  document: "Document",
  documentPage: "In document",
  discount: "Discount",
  amendment: "Amendment",
  vendor: "Vendor",
};

// Database-driven search across projects, challans, bills, payments,
// documents, discounts, amendments and vendors (services/searchService.ts).
// The prototype only had a client-side project-name filter scoped to the
// dashboard list (kept as-is on that page) — this is an additive header
// search using the same visual language (no new colors/typography), needed
// because multi-entity search has to work from any page, not just the list.
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced fetch triggered from the input's own change handler, not an
  // effect watching `query` — avoids the setState-in-effect anti-pattern
  // entirely (same fix applied to hooks/usePrintPortal.ts earlier).
  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(value)}`)
        .then((r) => r.json())
        .then((data) => setResults(data.results ?? []))
        .finally(() => setLoading(false));
    }, 250);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className={styles.wrap} ref={containerRef}>
      <Search size={14} className={styles.icon} aria-hidden />
      <input
        type="search"
        placeholder="Search projects, challans, bills…"
        aria-label="Global search"
        className={styles.input}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className={styles.panel} role="listbox">
          {loading && <div className={styles.empty}>Searching…</div>}
          {!loading && results.length === 0 && <div className={styles.empty}>No matches.</div>}
          {!loading &&
            results.map((r) => (
              <Link
                key={`${r.type}-${r.id}`}
                href={r.projectId ? `/projects/${r.projectId}` : "#"}
                className={styles.item}
                onClick={() => setOpen(false)}
              >
                <span className={styles.type}>{TYPE_LABEL[r.type]}</span>
                <span className={styles.title}>{r.title}</span>
                <span className={styles.subtitle}>{r.subtitle}</span>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
