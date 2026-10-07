"use client";

import { useEffect } from "react";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <>
      {/* Invisible backdrop to catch outside clicks */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-8 left-0 z-50 overflow-hidden rounded-[10px] border border-border-strong shadow-[0_12px_32px_rgba(0,0,0,0.6)] [&_em-emoji-picker]:[--rgb-background:25,24,22] [&_em-emoji-picker]:[--rgb-input:33,31,29] [&_em-emoji-picker]:[--rgb-color:238,234,227] [&_em-emoji-picker]:[--rgb-accent:243,238,229] [&_em-emoji-picker]:[--color-border:rgba(255,255,255,0.06)]">
        <Picker
          data={data}
          onEmojiSelect={(emoji: { native: string }) => onSelect(emoji.native)}
          theme="dark"
          previewPosition="none"
          skinTonePosition="none"
          perLine={7}
          emojiSize={22}
          emojiButtonSize={30}
          maxFrequentRows={1}
          set="native"
        />
      </div>
    </>
  );
}
