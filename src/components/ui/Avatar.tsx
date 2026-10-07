import { cx } from "./cx";

interface AvatarProps {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
  className?: string;
}

/** A coloured initial. Falls back to a neutral swatch when the member has no colour. */
export function Avatar({ name, color, size = 22, className }: AvatarProps) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-on-ivory", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        backgroundColor: color || "#8A8580",
      }}
    >
      {initial}
    </span>
  );
}
