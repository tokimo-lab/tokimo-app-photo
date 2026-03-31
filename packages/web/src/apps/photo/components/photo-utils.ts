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
  const swapped = isOrientationSwapped(photo.orientation);
  return swapped
    ? { width: photo.height, height: photo.width }
    : { width: photo.width, height: photo.height };
}

/** Whether the EXIF orientation swaps width/height (90° or 270° rotation). */
export function isOrientationSwapped(
  orientation: number | null | undefined,
): boolean {
  return orientation != null && orientation >= 5 && orientation <= 8;
}

/**
 * Transform a point from raw image coordinates to display coordinates,
 * accounting for EXIF orientation.
 *
 * OCR results are stored in raw sensor space. The browser auto-rotates the
 * displayed image via EXIF, so overlay coordinates must be transformed to
 * match. The `rawW`/`rawH` are the original sensor dimensions.
 *
 * EXIF orientations:
 *   1 = normal          5 = flip-H + 90°CW
 *   2 = flip-H          6 = 90°CW
 *   3 = 180°            7 = flip-H + 270°CW
 *   4 = flip-V          8 = 270°CW (= 90°CCW)
 */
export function transformPointForOrientation(
  x: number,
  y: number,
  rawW: number,
  rawH: number,
  orientation: number | null | undefined,
): { x: number; y: number } {
  switch (orientation) {
    case 2:
      return { x: rawW - x, y };
    case 3:
      return { x: rawW - x, y: rawH - y };
    case 4:
      return { x, y: rawH - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: rawH - y, y: x };
    case 7:
      return { x: rawH - y, y: rawW - x };
    case 8:
      return { x: y, y: rawW - x };
    default:
      return { x, y };
  }
}

/**
 * Transform an OCR bounding box (oriented rectangle) from raw to display space.
 *
 * The box's intrinsic dimensions (w, h) stay the same — they represent the
 * text region size, not axis-aligned extents. Only center and angle change.
 */
export function transformBboxForOrientation(
  box: { x: number; y: number; w: number; h: number; angle: number },
  rawW: number,
  rawH: number,
  orientation: number | null | undefined,
): { x: number; y: number; w: number; h: number; angle: number } {
  if (!orientation || orientation === 1) return box;

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const tc = transformPointForOrientation(cx, cy, rawW, rawH, orientation);
  const displayAngle = transformAngleForOrientation(box.angle, orientation);

  return {
    x: tc.x - box.w / 2,
    y: tc.y - box.h / 2,
    w: box.w,
    h: box.h,
    angle: displayAngle,
  };
}

/**
 * Transform quad corner coordinates from raw to display space.
 */
export function transformCornersForOrientation(
  corners: [number, number][],
  rawW: number,
  rawH: number,
  orientation: number | null | undefined,
): [number, number][] {
  if (!orientation || orientation === 1) return corners;
  return corners.map(([cx, cy]) => {
    const t = transformPointForOrientation(cx, cy, rawW, rawH, orientation);
    return [t.x, t.y];
  });
}

/**
 * Reverse-transform corners from display space back to raw image space.
 */
export function inverseTransformCornersForOrientation(
  displayCorners: [number, number][],
  rawW: number,
  rawH: number,
  orientation: number | null | undefined,
): [number, number][] {
  if (!orientation || orientation === 1) return displayCorners;
  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? rawH : rawW;
  const dispH = swapped ? rawW : rawH;
  const invOri = inverseOrientation(orientation);
  return displayCorners.map(([cx, cy]) => {
    const t = transformPointForOrientation(cx, cy, dispW, dispH, invOri);
    return [t.x, t.y];
  });
}

/**
 * Transform an axis-aligned box (e.g. face box with no rotation) from raw
 * to display space. Returns the axis-aligned bounding box of the result.
 */
export function transformAxisAlignedBoxForOrientation(
  box: { x: number; y: number; w: number; h: number },
  rawW: number,
  rawH: number,
  orientation: number | null | undefined,
): { x: number; y: number; w: number; h: number } {
  if (!orientation || orientation === 1) return box;
  const corners: [number, number][] = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ];
  const tc = transformCornersForOrientation(corners, rawW, rawH, orientation);
  const xs = tc.map(([x]) => x);
  const ys = tc.map(([, y]) => y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Transform angle (degrees) from raw image space to display space.
 * Accounts for both rotation and reflection components of EXIF orientation.
 */
function transformAngleForOrientation(
  angle: number,
  orientation: number | null | undefined,
): number {
  switch (orientation) {
    case 2:
      return 180 - angle;
    case 3:
      return angle + 180;
    case 4:
      return -angle;
    case 5:
      return 90 - angle;
    case 6:
      return angle + 90;
    case 7:
      return 270 - angle;
    case 8:
      return angle + 270;
    default:
      return angle;
  }
}

/**
 * Inverse orientation mapping: applying forward transform then inverse
 * transform (with display dims) returns the original point.
 */
function inverseOrientation(orientation: number | null | undefined): number {
  switch (orientation) {
    case 6:
      return 8;
    case 8:
      return 6;
    default:
      return orientation ?? 1;
  }
}
