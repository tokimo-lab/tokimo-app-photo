import type { PhotoOutput } from "../../generated/rust-api";

export const PAGE_SIZE = 80;
export const THUMB_WIDTH = 320;

export type DateGroup = {
  date: string;
  label: string;
  photos: PhotoOutput[];
};

export function groupPhotosByDate(photos: PhotoOutput[]): DateGroup[] {
  const groups: DateGroup[] = [];
  const map = new Map<string, PhotoOutput[]>();

  for (const photo of photos) {
    const dateStr = photo.takenAt ? photo.takenAt.slice(0, 10) : "未知日期";
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr)!.push(photo);
  }

  for (const [date, items] of map) {
    const d = new Date(date);
    const label =
      date === "未知日期"
        ? date
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    groups.push({ date, label, photos: items });
  }

  return groups;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
