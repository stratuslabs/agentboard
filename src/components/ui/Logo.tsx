import { cx } from "./cx";

/** The AgentBoard mark. `size` is the rendered square in px. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny static mark; next/image adds nothing here
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      className={cx("shrink-0 border border-white/[0.08] bg-[#050505]", className)}
      style={{ borderRadius: Math.round(size / 4) }}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("font-semibold tracking-[-0.1px] text-text-1", className)}>AgentBoard</span>
  );
}
