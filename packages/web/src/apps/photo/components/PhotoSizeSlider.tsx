import { Slider } from "@tokiomo/components";
import { Image, LayoutGrid } from "lucide-react";
import { useCallback } from "react";

/** Discrete size levels with corresponding target row heights (px). */
export const PHOTO_SIZE_LEVELS = [
  { label: "极小", height: 80 },
  { label: "小", height: 130 },
  { label: "中", height: 200 },
  { label: "大", height: 300 },
  { label: "极大", height: 420 },
] as const;

export const DEFAULT_SIZE_INDEX = 1; // "小"

const STORAGE_KEY = "tokimo:photo-grid-size";

export function loadSavedSizeIndex(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v !== null) {
      const n = Number.parseInt(v, 10);
      if (n >= 0 && n < PHOTO_SIZE_LEVELS.length) return n;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SIZE_INDEX;
}

export function saveSizeIndex(index: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(index));
  } catch {
    /* ignore */
  }
}

export function PhotoSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (index: number) => void;
}) {
  const max = PHOTO_SIZE_LEVELS.length - 1;

  const handleChange = useCallback(
    (v: number) => {
      onChange(v);
      saveSizeIndex(v);
    },
    [onChange],
  );

  return (
    <div
      className="flex items-center gap-1.5"
      title={PHOTO_SIZE_LEVELS[value].label}
    >
      <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
      <Slider
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={handleChange}
        size="small"
        className="w-20"
      />
      <Image className="h-4 w-4 shrink-0 text-fg-muted" />
    </div>
  );
}
