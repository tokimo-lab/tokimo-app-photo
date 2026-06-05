import type { WindowState } from "@/system/window/window-types";

export function stripExifQuotes(value: unknown): string {
  const text = String(value ?? "");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

export interface ExifWindowMetadata {
  exifData: Record<string, unknown>;
}

export default function ExifWindow({ win }: { win: WindowState }) {
  const meta = win.metadata as ExifWindowMetadata | undefined;
  const exifData = meta?.exifData ?? {};
  const sortedKeys = Object.keys(exifData).sort();

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="space-y-px font-mono text-sm">
        {sortedKeys.map((key, i) => (
          <div
            key={key}
            className={`flex justify-between gap-4 rounded px-2 py-1 ${
              i % 2 === 0 ? "bg-black/[0.04] dark:bg-white/[0.04]" : ""
            }`}
          >
            <span className="shrink-0 text-[var(--color-fg-muted)]">{key}</span>
            <span className="break-all text-right text-[var(--color-fg-secondary)]">
              {stripExifQuotes(exifData[key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
