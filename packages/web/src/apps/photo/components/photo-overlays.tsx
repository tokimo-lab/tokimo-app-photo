/**
 * Shared overlay components for photo viewing (used by both
 * PhotoLightbox and PhotoWindowViewer).
 *
 * Core OCR algorithms (hit testing, selection, char positioning)
 * run in WebAssembly via @tokiomo/tokimo-wasm for performance.
 * Canvas.measureText (browser API) stays in JS.
 */

import { useEffect, useState } from "react";
import type { PhotoFaceOutput, PhotoOcrResultItem } from "@/generated/rust-api";
import {
  isOrientationSwapped,
  transformAxisAlignedBoxForOrientation,
  transformBboxForOrientation,
  transformCornersForOrientation,
} from "./photo-utils";

export { OcrBboxEditOverlay } from "./OcrBboxEditOverlay";
export { OcrBlockSelectLayer } from "./OcrBlockSelectLayer";

// ── Shared image rect measurement hook ──────────────────────────────────────

export interface ImgRect {
  w: number;
  h: number;
  offsetX: number;
  offsetY: number;
}

export function useImgRect(
  imgRef: React.RefObject<HTMLImageElement | null>,
  photoWidth: number,
  photoHeight: number,
): ImgRect | null {
  const [imgRect, setImgRect] = useState<ImgRect | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const measure = () => {
      // Use offsetWidth/offsetHeight — these return CSS layout dimensions
      // (pre-transform), unlike getBoundingClientRect() which includes
      // CSS transform scaling and would double-count zoom.
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      if (w === 0 || h === 0) return;
      const imgAspect = photoWidth / photoHeight;
      const elemAspect = w / h;

      let renderedW: number;
      let renderedH: number;
      if (imgAspect > elemAspect) {
        renderedW = w;
        renderedH = w / imgAspect;
      } else {
        renderedH = h;
        renderedW = h * imgAspect;
      }

      setImgRect({
        w: renderedW,
        h: renderedH,
        offsetX: (w - renderedW) / 2,
        offsetY: (h - renderedH) / 2,
      });
    };

    measure();
    img.addEventListener("load", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    return () => {
      img.removeEventListener("load", measure);
      observer.disconnect();
    };
  }, [imgRef, photoWidth, photoHeight]);

  return imgRect;
}

// ── Face Highlight Overlay ──────────────────────────────────────────────────

export function FaceHighlightOverlay({
  faces,
  hoveredFaceId,
  photoWidth,
  photoHeight,
  imgRef,
  orientation,
}: {
  faces: PhotoFaceOutput[];
  hoveredFaceId: number;
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  orientation?: number | null;
}) {
  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;
  const imgRect = useImgRect(imgRef, dispW, dispH);
  if (!imgRect) return null;

  const scaleX = imgRect.w / dispW;
  const scaleY = imgRect.h / dispH;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: imgRect.offsetX,
        top: imgRect.offsetY,
        width: imgRect.w,
        height: imgRect.h,
      }}
    >
      {faces.map((face) => {
        const isHovered = face.id === hoveredFaceId;
        if (!isHovered) return null;

        const df = transformAxisAlignedBoxForOrientation(
          face,
          photoWidth,
          photoHeight,
          orientation,
        );
        const pad = Math.max(df.w, df.h) * 0.15;
        return (
          <div
            key={face.id}
            className="absolute rounded-md border-2 border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.4)]"
            style={{
              left: (df.x - pad) * scaleX,
              top: (df.y - pad) * scaleY,
              width: (df.w + pad * 2) * scaleX,
              height: (df.h + pad * 2) * scaleY,
            }}
          />
        );
      })}
    </div>
  );
}

// ── OCR Highlight Overlay ───────────────────────────────────────────────────

export function OcrHighlightOverlay({
  ocrResults,
  hoveredOcrId,
  photoWidth,
  photoHeight,
  imgRef,
  orientation,
}: {
  ocrResults: PhotoOcrResultItem[];
  hoveredOcrId: string;
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  orientation?: number | null;
}) {
  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;
  const imgRect = useImgRect(imgRef, dispW, dispH);
  if (!imgRect) return null;

  const scaleX = imgRect.w / dispW;
  const scaleY = imgRect.h / dispH;

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: imgRect.offsetX,
        top: imgRect.offsetY,
        width: imgRect.w,
        height: imgRect.h,
      }}
    >
      {ocrResults.map((r) => {
        if (r.id !== hoveredOcrId) return null;
        if (r.x == null || r.y == null || r.w == null || r.h == null)
          return null;

        // Quad corners mode — render SVG polygon
        if (r.corners && r.corners.length === 4) {
          const dc = transformCornersForOrientation(
            r.corners,
            photoWidth,
            photoHeight,
            orientation,
          );
          const points = dc
            .map(([cx, cy]) => `${cx * scaleX},${cy * scaleY}`)
            .join(" ");
          return (
            <svg
              key={r.id}
              className="absolute left-0 top-0"
              width={imgRect.w}
              height={imgRect.h}
            >
              <polygon
                points={points}
                fill="rgba(52,211,153,0.15)"
                stroke="rgb(52,211,153)"
                strokeWidth={2}
              />
            </svg>
          );
        }

        const db = transformBboxForOrientation(
          { x: r.x, y: r.y, w: r.w, h: r.h, angle: r.angle ?? 0 },
          photoWidth,
          photoHeight,
          orientation,
        );
        return (
          <div
            key={r.id}
            className="absolute rounded border-2 border-emerald-400 bg-emerald-400/15 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
            style={{
              left: db.x * scaleX,
              top: db.y * scaleY,
              width: db.w * scaleX,
              height: db.h * scaleY,
              transform: `rotate(${db.angle}deg)`,
              transformOrigin: "center center",
            }}
          />
        );
      })}
    </div>
  );
}
