import { Image, LayoutGrid } from "lucide-react";
import { useCallback, useId } from "react";

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
  const sliderId = useId();
  const max = PHOTO_SIZE_LEVELS.length - 1;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const idx = Number.parseInt(e.target.value, 10);
      onChange(idx);
      saveSizeIndex(idx);
    },
    [onChange],
  );

  return (
    <div
      className="flex items-center gap-1.5"
      title={PHOTO_SIZE_LEVELS[value].label}
    >
      <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
      <input
        id={sliderId}
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        onChange={handleChange}
        className="
          h-1 w-20 cursor-pointer appearance-none rounded-full
          bg-neutral-200 outline-none
          dark:bg-neutral-700
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-neutral-500
          [&::-webkit-slider-thumb]:transition-colors
          [&::-webkit-slider-thumb]:hover:bg-neutral-600
          [&::-webkit-slider-thumb]:dark:bg-neutral-400
          [&::-webkit-slider-thumb]:dark:hover:bg-neutral-300
          [&::-moz-range-thumb]:h-3.5
          [&::-moz-range-thumb]:w-3.5
          [&::-moz-range-thumb]:appearance-none
          [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-0
          [&::-moz-range-thumb]:bg-neutral-500
          [&::-moz-range-thumb]:transition-colors
          [&::-moz-range-thumb]:hover:bg-neutral-600
          [&::-moz-range-thumb]:dark:bg-neutral-400
          [&::-moz-range-thumb]:dark:hover:bg-neutral-300
        "
      />
      <Image className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
    </div>
  );
}
