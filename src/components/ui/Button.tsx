import { forwardRef } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ivory text-on-ivory hover:bg-ivory-hover",
  secondary: "bg-surface-3 text-text-1 border border-border-strong hover:bg-surface-4",
  ghost: "text-text-2 hover:text-text-1 hover:bg-surface-3",
  danger: "bg-danger text-white hover:brightness-110",
  "danger-ghost": "text-danger hover:bg-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-[30px] px-2.5 text-[13px] gap-1.5 rounded-md",
  md: "h-[34px] px-3.5 text-[13px] gap-2 rounded-[7px]",
  lg: "h-10 px-4 text-[13.5px] gap-2 rounded-[7px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ivory/30",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});

/** A square, icon-only button. Always give it an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: number }>(
  function IconButton({ className, size = 26, type = "button", style, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-md text-text-3 transition-colors",
          "hover:bg-surface-3 hover:text-text-1 disabled:opacity-40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ivory/30",
          className,
        )}
        style={{ width: size, height: size, ...style }}
        {...rest}
      />
    );
  },
);
