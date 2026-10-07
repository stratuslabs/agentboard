"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Ellipsis } from "lucide-react";
import { Avatar, ColorSwatches, IconButton, MenuPanel, cx } from "../ui";

/** The bordered card that holds member groups. */
export function MemberListCard({ children }: { children: React.ReactNode }) {
  // Not overflow-hidden: a row's menu has to hang past the last row. The
  // first and last rows round themselves to the corners instead.
  return (
    <div className="rounded-[10px] border border-border bg-surface-1 [&>*:first-child]:rounded-t-[9px] [&>*:last-child]:rounded-b-[9px] [&>*:last-child]:border-b-0">
      {children}
    </div>
  );
}

export function MemberGroupHeader({ label, count, trailing }: { label: string; count: number; trailing?: React.ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-border bg-bg-sidebar pr-2.5 pl-4">
      <span className="font-mono text-[10.5px] tracking-[0.8px] text-text-3 uppercase">{label}</span>
      <span className="flex-1 font-mono text-[10.5px] text-text-4">{count}</span>
      {trailing}
    </div>
  );
}

interface MemberRowProps {
  name: string;
  color?: string | null;
  isAgent?: boolean;
  /** Dimmed, e.g. an invitation not yet accepted. */
  muted?: boolean;
  nameSuffix?: React.ReactNode;
  sub?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Shown in place of the row while editing. */
  editor?: React.ReactNode;
}

export function MemberRow({ name, color, isAgent, muted, nameSuffix, sub, trailing, editor }: MemberRowProps) {
  if (editor) return <div className="border-b border-border px-4 py-3">{editor}</div>;
  return (
    <div className="flex min-h-[60px] items-center gap-3 border-b border-border py-2.5 pr-2.5 pl-4">
      <Avatar name={name} color={color} size={30} className={muted ? "opacity-50" : undefined} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cx("truncate text-[13.5px] font-medium", muted ? "text-text-2" : "text-text-1")}>{name}</span>
          {isAgent && <Bot aria-label="Agent" className="h-[13px] w-[13px] shrink-0 text-silver" />}
          {nameSuffix}
        </div>
        {sub && <div className="truncate text-xs text-text-3">{sub}</div>}
      </div>
      {trailing}
    </div>
  );
}

/** The ⋯ button and its menu for a row. Closes on outside click and Escape. */
export function RowMenu({ label, children }: { label: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton size={28} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={open ? "bg-surface-3 text-text-1" : undefined}>
        <Ellipsis className="h-[15px] w-[15px]" />
      </IconButton>
      {open && <MenuPanel className="absolute top-8 right-0 w-[196px]">{children(() => setOpen(false))}</MenuPanel>}
    </div>
  );
}

/** Inline rename + recolour editor shared by member rows. */
export function MemberEditor({ initialName, initialColor, focus, onSave, onCancel }: {
  initialName: string;
  initialColor: string;
  focus: "name" | "color";
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Avatar name={name || initialName} color={color} size={30} />
        <input
          value={name}
          autoFocus={focus === "name"}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim(), color); if (e.key === "Escape") onCancel(); }}
          aria-label="Name"
          className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface-2 px-2.5 text-[13px] text-text-1 focus:border-text-4 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pl-[38px]">
        <ColorSwatches value={color} onChange={setColor} size={20} />
        <div className="flex gap-1.5">
          <button onClick={onCancel} className="h-7 rounded-md px-2.5 text-[12.5px] text-text-2 hover:bg-surface-3 hover:text-text-1">Cancel</button>
          <button onClick={() => name.trim() && onSave(name.trim(), color)} disabled={!name.trim()}
            className="h-7 rounded-md bg-ivory px-3 text-[12.5px] font-medium text-on-ivory hover:bg-ivory-hover disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}
