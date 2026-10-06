import { forwardRef } from "react";
import { cx } from "./cx";

/** Floating menu surface. Position it with `style`/`className`; it only paints. */
export const MenuPanel = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function MenuPanel(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      role="menu"
      className={cx(
        "z-50 flex min-w-[180px] flex-col gap-px rounded-[9px] border border-border-strong bg-surface-2 p-[5px]",
        "shadow-[0_12px_32px_rgba(0,0,0,0.6)] fade-in",
        className,
      )}
      {...rest}
    />
  );
});

interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  danger?: boolean;
  trailing?: React.ReactNode;
}

export function MenuItem({ icon, danger, trailing, className, children, type = "button", ...rest }: MenuItemProps) {
  return (
    <button
      type={type}
      role="menuitem"
      className={cx(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors",
        "hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none disabled:opacity-40",
        danger ? "text-danger" : "text-text-1",
        className,
      )}
      {...rest}
    >
      {icon && <span className={cx("flex h-[15px] w-[15px] shrink-0 items-center justify-center [&>svg]:h-[15px] [&>svg]:w-[15px]", danger ? "text-danger" : "text-text-2")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

export function MenuDivider() {
  return <div className="my-0.5 h-px bg-border-strong" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.8px] text-text-3 uppercase">{children}</div>;
}
