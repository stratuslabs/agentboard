"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Link2, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "./ui";
import { MAX_LINK_TITLE, MAX_LINK_URL, type CardLink, linkLabel } from "../lib/card-links";

interface CardLinksProps {
  cardId: number;
  /** The card's updated_at. Every link write bumps it, so a link added
   *  elsewhere (the CLI, another tab) reloads the list here. */
  cardUpdatedAt: string;
}

const INPUT =
  "h-8 min-w-0 rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-text-1 placeholder:text-text-4 focus:border-text-4 focus:outline-none";

/** The host a link points at, shown under its title. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Links on a card: any http(s) URL, such as a Slack thread, a doc or a design.
 * The GitHub issue and PR stay in the card's properties.
 */
export default function CardLinks({ cardId, cardUpdatedAt }: CardLinksProps) {
  const [links, setLinks] = useState<CardLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest load may set the list; an older response is stale. A
  // local add or remove also bumps it, so a load already in flight can't undo
  // the change.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch(`/api/cards/${cardId}/links`);
      if (!res.ok) return;
      const list: CardLink[] = await res.json();
      // Check after the body is read: a newer load or a write may have landed
      // while it was streaming.
      if (seq !== loadSeq.current) return;
      setLinks(list);
    } catch {
      // keep what we have; the next change reloads
    } finally {
      setLoaded(true);
    }
  }, [cardId]);

  useEffect(() => { void load(); }, [load, cardUpdatedAt]);

  async function errorOf(res: Response): Promise<string> {
    const body = await res.json().catch(() => ({}));
    return body.error || `Request failed (${res.status})`;
  }

  function close() {
    setAdding(false);
    setUrl("");
    setTitle("");
  }

  async function add() {
    if (!url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${cardId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined }),
      });
      if (!res.ok) { setError(await errorOf(res)); return; }
      const saved: CardLink = await res.json();
      loadSeq.current++;
      // A URL already on the card comes back as the same link, retitled.
      setLinks((prev) => (prev.some((l) => l.id === saved.id) ? prev.map((l) => (l.id === saved.id ? saved : l)) : [...prev, saved]));
      close();
    } catch {
      setError("Couldn't save the link");
    } finally {
      setSaving(false);
    }
  }

  async function remove(link: CardLink) {
    setError(null);
    loadSeq.current++;
    setLinks((prev) => prev.filter((l) => l.id !== link.id));
    try {
      const res = await fetch(`/api/cards/${cardId}/links`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.url }),
      });
      // Already gone is what we wanted.
      if (!res.ok && res.status !== 404) throw new Error(await errorOf(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove the link");
      void load();
    }
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Links" role="group">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-text-2">Links</h3>
        {links.length > 0 && <span className="font-mono text-[11px] text-text-4">{links.length}</span>}
      </div>

      {links.length > 0 && (
        <ul className="-mx-1.5 flex flex-col">
          {links.map((link) => (
            <li key={link.id} className="group/link flex min-h-9 items-center gap-2.5 rounded-md px-1.5 transition-colors hover:bg-surface-3">
              <Link2 className="h-4 w-4 shrink-0 text-text-3" />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                title={link.url}
                className="flex min-w-0 flex-1 items-baseline gap-2 py-1 text-[13px]"
              >
                <span className="min-w-0 truncate text-text-1">{linkLabel(link)}</span>
                {/* The host gives way before the title on a narrow panel. */}
                {link.title && <span className="min-w-0 shrink-[4] truncate text-[11.5px] text-text-4">{hostOf(link.url)}</span>}
                <ArrowUpRight className="h-3 w-3 shrink-0 self-center text-text-3" />
              </a>
              <IconButton
                size={24}
                aria-label={`Remove link: ${linkLabel(link)}`}
                title="Remove"
                onClick={() => remove(link)}
                className="opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100 hover:text-danger max-md:opacity-100"
              >
                <Trash2 className="h-[13px] w-[13px]" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className="flex flex-col gap-2 rounded-lg border border-border-strong bg-surface-1 p-3"
          onSubmit={(e) => { e.preventDefault(); void add(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
        >
          <input
            type="url"
            autoFocus
            value={url}
            maxLength={MAX_LINK_URL}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… a Slack thread, doc or design"
            aria-label="Link URL"
            className={INPUT}
          />
          <input
            value={title}
            maxLength={MAX_LINK_TITLE}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            aria-label="Link title"
            className={INPUT}
          />
          <div className="flex gap-1.5">
            <Button type="submit" variant="primary" size="sm" disabled={!url.trim() || saving}>Add link</Button>
            <Button type="button" variant="ghost" size="sm" onClick={close}>Cancel</Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => { setError(null); setAdding(true); }}
          disabled={!loaded}
          className="-mx-1.5 flex h-8 items-center gap-2.5 rounded-md px-1.5 text-[13px] text-text-3 transition-colors hover:bg-surface-3 hover:text-text-2"
        >
          <Plus className="h-4 w-4" />
          Add link
        </button>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
