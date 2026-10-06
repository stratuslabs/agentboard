import { cx } from "./cx";

/** A label chip: mono text on a raised surface. */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex h-5 items-center rounded px-[7px] font-mono text-[11px] text-text-2 bg-surface-3", className)}>
      {children}
    </span>
  );
}

/** A coloured pill with a dot, e.g. a column name. `color` is any CSS colour. */
export function StatusBadge({ color, children, className }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap", className)}
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

const PRIORITY_BG: Record<string, string> = {
  urgent: "bg-priority-urgent",
  high: "bg-priority-high",
  medium: "bg-priority-medium",
  low: "bg-priority-low",
};

export function PriorityDot({ priority, className }: { priority: string; className?: string }) {
  return (
    <span
      title={priority}
      className={cx("inline-block h-[7px] w-[7px] shrink-0 rounded-full", PRIORITY_BG[priority] || PRIORITY_BG.medium, className)}
    />
  );
}
