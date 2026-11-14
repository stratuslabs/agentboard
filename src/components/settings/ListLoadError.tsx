"use client";

import { useState } from "react";
import { CloudOff } from "lucide-react";
import { Button } from "../ui";

/**
 * In a list's place when it couldn't load (members, default boards, default
 * columns): what went wrong and a Try again button. The button stays focusable
 * while the retry runs, so a keyboard user who presses it again after another
 * failure is still on it.
 */
export function ListLoadError({ title, onRetry }: { title: string; onRetry: () => Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[10px] border border-border bg-surface-1 px-4 py-6 text-center">
      <CloudOff aria-hidden className="h-[18px] w-[18px] text-text-3" />
      <div className="flex flex-col gap-1">
        <p className="text-[13.5px] font-medium text-text-1">{title}</p>
        <p className="text-xs text-text-2">Check your connection and try again.</p>
      </div>
      <Button size="sm" onClick={retry} aria-disabled={retrying || undefined} className={retrying ? "cursor-wait opacity-60" : undefined}>
        {retrying ? "Trying again…" : "Try again"}
      </Button>
    </div>
  );
}
