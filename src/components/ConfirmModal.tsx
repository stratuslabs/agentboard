"use client";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-surface-800 border border-surface-600 rounded-xl shadow-2xl w-80 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-md hover:bg-surface-700 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="px-3 py-1.5 text-sm text-white bg-red-500/80 hover:bg-red-500 rounded-md transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
