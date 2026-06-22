import type { WindowState } from "@tokimo/sdk";

/**
 * Unified EXIF value cleaner — mirrors backend `clean_exif_value()`.
 * Handles all formats from `kamadak-exif`:
 *   - Simple quoted: `"R98"` → `R98`
 *   - Quoted + spaces: `"Meizu     "` → `Meizu`
 *   - Quoted array: `"Flyme4.0", "", "", ...` → `Flyme4.0`
 *   - All-empty array: `"", "", ...` → `""` (caller filters)
 */
export function stripExifQuotes(value: string): string {
  if (!value.includes('"')) return value.trim();

  const parts = value
    .split('", "')
    .map((s) =>
      s
        .trim()
        .replace(/^"|"$/g, "")
        .trim(),
    )
    .filter((s) => s.length > 0);

  return parts.join(", ");
}

export interface ExifWindowMetadata {
  exifData: Record<string, string>;
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
            <span className="shrink-0 text-[var(--text-muted)]">{key}</span>
            <span className="break-all text-right text-[var(--text-secondary)]">
              {stripExifQuotes(exifData[key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
