"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

interface DialogProps {
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  /** Darker, blurred scrim for blocking dialogs such as first-run setup. */
  heavy?: boolean;
  /** Set false when the dialog must not be dismissed by Escape or a scrim click. */
  dismissable?: boolean;
  z?: number;
}

/** A centred modal on a scrim, portalled to <body>. */
export function Dialog({ onClose, children, className, heavy, dismissable = true, z = 100 }: DialogProps) {
  useEffect(() => {
    if (!dismissable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, dismissable]);

  return createPortal(
    <div
      className={cx("fixed inset-0 flex items-center justify-center p-4", heavy ? "bg-[#050404cc] backdrop-blur-[6px]" : "bg-[#05040499]")}
      style={{ zIndex: z }}
      onClick={dismissable ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "fade-in max-h-full overflow-hidden rounded-[14px] border border-border-strong bg-surface-1",
          "shadow-[0_24px_64px_rgba(0,0,0,0.7)]",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
