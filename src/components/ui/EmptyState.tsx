import { cx } from "./cx";

/** Centred icon tile, heading, body and optional action. */
export function EmptyState({ icon, title, body, action, className }: {
  icon: React.ReactNode;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3.5 text-center", className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-[14px] border border-border-strong bg-surface-1 text-text-2 [&>svg]:h-[22px] [&>svg]:w-[22px]">
        {icon}
      </div>
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-[15px] font-medium text-text-1">{title}</h2>
        {body && <p className="max-w-sm text-[13px] text-text-3">{body}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** The three-bar pulse shown while a screen restores. */
export function PageLoader() {
  return (
    <div className="flex flex-1 items-center justify-center" aria-label="Loading" role="status">
      <div className="flex items-end gap-1.5">
        <div className="h-8 w-2 animate-pulse rounded-sm bg-ivory/80" />
        <div className="h-6 w-2 animate-pulse rounded-sm bg-ivory/40 [animation-delay:150ms]" />
        <div className="h-4 w-2 animate-pulse rounded-sm bg-ivory/20 [animation-delay:300ms]" />
      </div>
    </div>
  );
}
