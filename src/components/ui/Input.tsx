import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";

const FIELD =
  "w-full rounded-[7px] border border-border-strong bg-surface-2 px-3 text-[13px] text-text-1 " +
  "placeholder:text-text-3 transition-colors " +
  "focus:border-text-4 focus:outline-none focus:ring-2 focus:ring-ivory/10 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export const inputClass = FIELD;

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { inputSize?: "md" | "lg" }>(
  function Input({ className, inputSize = "md", ...rest }, ref) {
    return <input ref={ref} className={cx(FIELD, inputSize === "lg" ? "h-10" : "h-9", "[color-scheme:dark]", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(FIELD, "py-2 leading-relaxed", className)} {...rest} />;
  },
);

/** A native select dressed as an input, with a chevron. Native keeps keyboard and screen-reader behaviour for free. */
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { selectSize?: "sm" | "md" }>(
  function Select({ className, children, selectSize = "md", ...rest }, ref) {
    return (
      <span className={cx("relative inline-flex", className)}>
        <select
          ref={ref}
          className={cx(
            FIELD,
            "appearance-none pr-8",
            selectSize === "sm" ? "h-[34px]" : "h-9",
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
      </span>
    );
  },
);

export function Field({ label, children, className, htmlFor }: { label: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-2">
        {label}
      </label>
      {children}
    </div>
  );
}
