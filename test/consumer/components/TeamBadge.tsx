"use client";

/** Stands in for a hosted edition's team switcher in the sidebar. */
export default function TeamBadge({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <span data-consumer-slot="sidebar-rail" title="Consumer Team" className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-[11px] font-semibold text-text-1">
        CT
      </span>
    );
  }
  return (
    <div data-consumer-slot="sidebar-footer" className="flex h-[30px] items-center gap-2 rounded-md px-2 text-[12.5px] text-text-2">
      <span className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 text-[10px] font-semibold text-text-1">CT</span>
      Consumer Team
    </div>
  );
}
