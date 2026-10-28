"use client";

/**
 * Cmd+K (Ctrl+K off a Mac) quick search: type a few words or a card's key and
 * jump to the card, wherever it lives. Mounted once by BoardLayout, so every
 * board screen has it, in the core and in apps built on it.
 *
 * Results come from GET /api/cards/search, which reads the query the same way
 * as a board's text filter. Arrow keys move, Enter opens, Escape closes.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, PriorityDot, StatusBadge, cx } from "./ui";
import {
  QUICK_SEARCH_EVENT,
  type SearchResult,
  productPath,
  requestOpenCard,
  resultHref,
} from "../lib/quick-search";
import { writeCardParam } from "../lib/cards";

const DEBOUNCE_MS = 150;
const LIMIT = 20;

export default function QuickSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
      }
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(QUICK_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(QUICK_SEARCH_EVENT, onOpen);
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return open ? <QuickSearchDialog onClose={close} /> : null;
}

type Status = "idle" | "loading" | "done" | "error";

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const [query, setQuery] = useState("");
  // The last answer and the query it was for, and the last query that failed.
  // What's on screen is derived from these, so a new query shows "Searching"
  // until its own answer arrives, while the previous results stay up.
  const [answer, setAnswer] = useState<{ q: string; rows: SearchResult[] } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // Enter pressed before the current query's answer arrived: open its first
  // result when it does, rather than whatever the previous query found.
  const enterPending = useRef(false);
  const openFirstRef = useRef<(rows: SearchResult[]) => void>(() => {});

  const q = query.trim();
  const results = q && answer ? answer.rows : [];
  const status: Status = !q ? "idle" : failedFor === q ? "error" : answer?.q === q ? "done" : "loading";

  useEffect(() => {
    if (!q) return;
    // The last request wins: a slower answer to an older query is dropped.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}&limit=${LIMIT}`, { signal: controller.signal });
        if (!r.ok) throw new Error(`search failed: ${r.status}`);
        const rows: SearchResult[] = await r.json();
        setAnswer({ q, rows });
        setFailedFor(null);
        setActive(0);
        if (enterPending.current) {
          enterPending.current = false;
          openFirstRef.current(rows);
        }
      } catch {
        if (controller.signal.aborted) return;
        enterPending.current = false;
        setFailedFor(q);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openResult(result: SearchResult) {
    onClose();
    if (pathname === productPath(result)) {
      // The board on screen reads ?card= only when it mounts; ask it directly.
      // If it hasn't mounted yet (the product is still loading), leave the
      // link in the address bar for it to read when it does.
      if (!requestOpenCard(result.id)) writeCardParam(result.id);
    } else {
      router.push(resultHref(result));
    }
  }

  useEffect(() => {
    openFirstRef.current = (rows) => {
      if (rows[0]) openResult(rows[0]);
    };
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (status === "loading") enterPending.current = true;
      else if (status === "done" && results[active]) openResult(results[active]);
    }
  }

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <Dialog onClose={onClose} className="w-[560px] max-w-full self-start mt-[12vh]">
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="h-4 w-4 shrink-0 text-text-3" />
        <input
          autoFocus
          role="combobox"
          aria-label="Search cards"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results[active] ? optionId(active) : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            enterPending.current = false;
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search cards by title or key, like AB-12"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-text-1 placeholder:text-text-4 focus:outline-none"
        />
        <kbd className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10.5px] text-text-3">Esc</kbd>
      </div>
      <div className="max-h-[52vh] overflow-y-auto">
        {results.length > 0 && (
          <ul ref={listRef} id={listId} role="listbox" aria-label="Cards" className="py-1.5">
            {results.map((r, i) => (
              <li
                key={r.id}
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => openResult(r)}
                className={cx(
                  "mx-1.5 flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2",
                  i === active ? "bg-surface-3" : "",
                )}
              >
                <PriorityDot priority={r.priority} />
                <span className="w-[64px] shrink-0 truncate font-mono text-[11.5px] text-text-3">{r.key ?? `#${r.id}`}</span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-[13px]", r.done ? "text-text-3 line-through" : "text-text-1")}>{r.title}</span>
                  <span className="block truncate text-[11.5px] text-text-3">
                    {r.product_emoji ? `${r.product_emoji} ` : ""}{r.product_name} · {r.board_name}
                  </span>
                </span>
                <StatusBadge color={r.column_color || "var(--color-text-3)"}>{r.column_name}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
        {results.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-text-3" role="status">
            {status === "error"
              ? "Search failed. Check your connection and try again."
              : !q
                ? "Type to search every board."
                : status === "done"
                  ? `No cards match “${q}”.`
                  : "Searching…"}
          </p>
        )}
        {results.length > 0 && status === "error" && (
          <p className="border-t border-border px-4 py-2 text-[11.5px] text-danger" role="status">
            Search failed. These results are from your previous search.
          </p>
        )}
      </div>
    </Dialog>
  );
}
