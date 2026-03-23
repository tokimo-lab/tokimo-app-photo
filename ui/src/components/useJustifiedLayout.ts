import type { PhotoOutput } from "../../generated/rust-api";

const TARGET_ROW_HEIGHT = 220;
const PHOTO_GAP = 2;

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
 * Each photo is scaled to TARGET_ROW_HEIGHT, then photos are packed
 * greedily into rows. When a row overflows, all photos in that row
 * are scaled to exactly fill containerWidth. The last row is capped
 * at TARGET_ROW_HEIGHT (not stretched).
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

  for (const photo of photos) {
    const ar =
      photo.width && photo.height && photo.height > 0
        ? photo.width / photo.height
        : 4 / 3; // default aspect ratio for unknown dimensions
    const scaledW = targetH * ar;

    // Would adding this photo overflow the row?
    const gapsIfAdded = buf.length * gap;
    if (bufW + scaledW + gapsIfAdded > containerWidth && buf.length > 0) {
      // Finalize current row — scale to fill width
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
