import type { PhotoOutput } from "../generated/rust-api";

const TARGET_ROW_HEIGHT = 220;
const PHOTO_GAP = 4;

/** Minimum rendered width for any photo (prevents 1px-wide tall images). */
const MIN_ITEM_WIDTH = 40;
/** Aspect ratio thresholds for extreme panoramas that get a solo row. */
const PANORAMA_AR_THRESHOLD = 3.5;

export interface JustifiedItem {
  photo: PhotoOutput;
  width: number;
  height: number;
}

export interface JustifiedRow {
  items: JustifiedItem[];
  height: number;
}

/**
 * Pack photos into justified rows that fill the container width.
 *
 * - Normal photos are packed greedily until a row overflows, then scaled
 *   to exactly fill containerWidth.
 * - Extreme panoramas (AR ≥ 3.5) get their own row and may be shorter
 *   than targetH to avoid exceeding container width.
 * - Very tall photos (AR ≤ 0.3) are clamped to a minimum width and
 *   rendered with object-cover cropping.
 */
export function computeJustifiedRows(
  photos: PhotoOutput[],
  containerWidth: number,
  targetH = TARGET_ROW_HEIGHT,
  gap = PHOTO_GAP,
): JustifiedRow[] {
  if (containerWidth <= 0 || photos.length === 0) return [];

  const rows: JustifiedRow[] = [];
  let buf: Array<{ photo: PhotoOutput; scaledW: number }> = [];
  let bufW = 0;

  const flushBuf = () => {
    if (buf.length === 0) return;
    const gaps = (buf.length - 1) * gap;
    const availW = containerWidth - gaps;
    const scale = availW / bufW;
    const rowH = Math.round(targetH * scale);

    rows.push({
      items: buf.map((p) => ({
        photo: p.photo,
        width: Math.round(p.scaledW * scale),
        height: rowH,
      })),
      height: rowH,
    });
    buf = [];
    bufW = 0;
  };

  for (const photo of photos) {
    const ar =
      photo.width && photo.height && photo.height > 0
        ? photo.width / photo.height
        : 4 / 3;

    // ── Extreme panorama → solo row, height may be < targetH ──
    if (ar >= PANORAMA_AR_THRESHOLD) {
      flushBuf();
      const soloW = containerWidth;
      const soloH = Math.round(soloW / ar);
      rows.push({
        items: [{ photo, width: soloW, height: soloH }],
        height: soloH,
      });
      continue;
    }

    // ── Clamp very tall photos to minimum width ──
    let scaledW = targetH * ar;
    if (scaledW < MIN_ITEM_WIDTH) {
      scaledW = MIN_ITEM_WIDTH;
    }

    // Would adding this photo overflow the row?
    const gapsIfAdded = buf.length * gap;
    if (bufW + scaledW + gapsIfAdded > containerWidth && buf.length > 0) {
      flushBuf();
    }

    buf.push({ photo, scaledW });
    bufW += scaledW;
  }

  // Last row — don't stretch beyond targetH
  if (buf.length > 0) {
    const gaps = (buf.length - 1) * gap;
    const availW = containerWidth - gaps;
    const scale = Math.min(1, availW / bufW);
    const rowH = Math.round(targetH * scale);

    rows.push({
      items: buf.map((p) => ({
        photo: p.photo,
        width: Math.round(p.scaledW * scale),
        height: rowH,
      })),
      height: rowH,
    });
  }

  return rows;
}
