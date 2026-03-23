import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function stripExifQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

interface ExifModalProps {
  exifData: Record<string, string>;
  onClose: () => void;
}

export function ExifModal({ exifData, onClose }: ExifModalProps) {
  const sortedKeys = Object.keys(exifData).sort();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="EXIF 原始数据"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold text-white">EXIF 原始数据</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-px font-mono text-sm">
            {sortedKeys.map((key, i) => (
              <div
                key={key}
                className={`flex justify-between gap-4 rounded px-2 py-1 ${
                  i % 2 === 0 ? "bg-white/5" : ""
                }`}
              >
                <span className="shrink-0 text-white/40">{key}</span>
                <span className="break-all text-right text-white/80">
                  {stripExifQuotes(exifData[key])}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-white/10 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
          >
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
