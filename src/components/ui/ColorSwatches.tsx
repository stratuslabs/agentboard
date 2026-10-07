import { cx } from "./cx";

/** Member colours offered everywhere a colour is picked. */
export const PRESET_COLORS = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#06B6D4",
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#8A8580",
];

interface ColorSwatchesProps {
  value: string;
  onChange: (color: string) => void;
  size?: number;
  disabled?: boolean;
  className?: string;
}

export function ColorSwatches({ value, onChange, size = 26, disabled, className }: ColorSwatchesProps) {
  return (
    <div role="radiogroup" aria-label="Color" className={cx("flex items-center gap-2", className)}>
      {PRESET_COLORS.map((c) => {
        const selected = value.toLowerCase() === c.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cx(
              "shrink-0 rounded-full transition-shadow",
              selected ? "ring-2 ring-ivory ring-offset-2 ring-offset-surface-1" : "hover:ring-2 hover:ring-border-strong hover:ring-offset-2 hover:ring-offset-surface-1",
            )}
            style={{ width: size, height: size, backgroundColor: c }}
          />
        );
      })}
    </div>
  );
}
