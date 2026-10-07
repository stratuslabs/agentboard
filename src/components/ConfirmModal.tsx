"use client";

import { Trash2 } from "lucide-react";
import { Button, Dialog } from "./ui";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, confirmLabel = "Delete", icon, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <Dialog onClose={onCancel} className="w-[400px] max-w-full">
      <div className="flex flex-col gap-2.5 px-6 pt-6 pb-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-danger/12 text-danger [&>svg]:h-[17px] [&>svg]:w-[17px]">
          {icon ?? <Trash2 />}
        </div>
        <h3 className="text-base font-semibold text-text-1">{title}</h3>
        <p className="text-[13px] leading-[1.55] text-text-2">{message}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-bg-sidebar px-4 py-3">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} autoFocus>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
