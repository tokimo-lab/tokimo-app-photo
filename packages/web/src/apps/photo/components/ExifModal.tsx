import { Modal } from "@tokimo/ui";
import { useRef } from "react";

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
  // Force portal to document.body to escape FloatingWindow's ModalContainerContext
  const bodyRef = useRef(document.body);

  return (
    <Modal
      open
      title="EXIF 原始数据"
      onCancel={onClose}
      footer={null}
      width={640}
      zIndex={10000}
      container={bodyRef}
    >
      <div className="space-y-px font-mono text-sm">
        {sortedKeys.map((key, i) => (
          <div
            key={key}
            className={`flex justify-between gap-4 rounded px-2 py-1 ${
              i % 2 === 0 ? "bg-black/[0.04] dark:bg-white/[0.04]" : ""
            }`}
          >
            <span className="shrink-0 text-[var(--text-muted)]">{key}</span>
            <span className="break-all text-right text-[var(--text-secondary)]">
              {stripExifQuotes(exifData[key])}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
