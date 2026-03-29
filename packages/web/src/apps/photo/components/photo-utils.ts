import type { PhotoOutput } from "@/generated/rust-api";

export const PAGE_SIZE = 80;
export const THUMB_WIDTH = 320;

export type DateGroup = {
  date: string;
  label: string;
  year: number;
  photos: PhotoOutput[];
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const today = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];

  if (
    y === today.getFullYear() &&
    m === today.getMonth() + 1 &&
    day === today.getDate()
  ) {
    return `今天 · ${m}月${day}日 ${wd}`;
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    y === yesterday.getFullYear() &&
    m === yesterday.getMonth() + 1 &&
    day === yesterday.getDate()
  ) {
    return `昨天 · ${m}月${day}日 ${wd}`;
  }

  if (y === today.getFullYear()) {
    return `${m}月${day}日 ${wd}`;
  }
  return `${y}年${m}月${day}日 ${wd}`;
}

export function groupPhotosByDate(photos: PhotoOutput[]): DateGroup[] {
  const map = new Map<string, PhotoOutput[]>();

  for (const photo of photos) {
    const dateStr = photo.takenAt ? photo.takenAt.slice(0, 10) : "未知日期";
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr)!.push(photo);
  }

  const groups: DateGroup[] = [];
  for (const [date, items] of map) {
    const label = date === "未知日期" ? date : formatDateLabel(date);
    const year =
      date === "未知日期" ? 0 : Number.parseInt(date.slice(0, 4), 10);
    groups.push({ date, label, year, photos: items });
  }

  return groups;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get display dimensions accounting for EXIF orientation.
 * Orientations 5-8 rotate the image 90°/270°, swapping width and height.
 * The database stores raw sensor dimensions (before rotation).
 */
export function getDisplayDimensions(
  photo: {
    width?: number | null;
    height?: number | null;
    orientation?: number | null;
  } | null,
): { width: number; height: number } | null {
  if (!photo?.width || !photo.height) return null;
  const swapped =
    photo.orientation != null &&
    photo.orientation >= 5 &&
    photo.orientation <= 8;
  return swapped
    ? { width: photo.height, height: photo.width }
    : { width: photo.width, height: photo.height };
}
