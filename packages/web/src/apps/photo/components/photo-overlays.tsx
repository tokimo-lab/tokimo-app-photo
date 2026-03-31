/**
 * Shared overlay components for photo viewing (used by both
 * PhotoLightbox and PhotoWindowViewer).
 *
 * Core OCR algorithms (hit testing, selection, char positioning)
 * run in WebAssembly via @tokiomo/tokimo-wasm for performance.
 * Canvas.measureText (browser API) stays in JS.
 */

import type { OcrEngine } from "@tokiomo/tokimo-wasm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoFaceOutput, PhotoOcrResultItem } from "@/generated/rust-api";
import {
  inverseTransformCornersForOrientation,
  isOrientationSwapped,
  transformAxisAlignedBoxForOrientation,
  transformBboxForOrientation,
  transformCornersForOrientation,
} from "./photo-utils";

// ── Shared image rect measurement hook ──────────────────────────────────────

interface ImgRect {
  w: number;
  h: number;
  offsetX: number;
  offsetY: number;
}

function useImgRect(
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

// ── OCR Bbox Edit Overlay (draggable corners + edges + rotation) ─────────────

const HANDLE_SIZE = 10;
const HANDLE_HALF = HANDLE_SIZE / 2;
const ROTATION_ARM = 24;

// Inline SVG rotation cursor — white fill, black outline, circular arrow
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 4a8 8 0 1 0 8 8' fill='none' stroke='%23000' stroke-width='2.5' stroke-linecap='round'/><path d='M12 4a8 8 0 1 0 8 8' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round'/><path d='M20 4v5h-5' fill='none' stroke='%23000' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/><path d='M20 4v5h-5' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>") 12 12, crosshair`;

// Quad edge definitions: [startCornerIdx, endCornerIdx] — TL→TR, TR→BR, BR→BL, BL→TL
const QUAD_EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
];

// SVG double-arrow cursor rotated to be parallel to an edge
function edgeCursor(x1: number, y1: number, x2: number, y2: number): string {
  const angle = Math.round(Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI));
  return `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${angle} 12 12)'><line x1='4' y1='12' x2='20' y2='12' stroke='%23000' stroke-width='3' stroke-linecap='round'/><polyline points='8,8 4,12 8,16' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><polyline points='16,8 20,12 16,16' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><line x1='4' y1='12' x2='20' y2='12' stroke='%23fff' stroke-width='1.5' stroke-linecap='round'/><polyline points='8,8 4,12 8,16' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/><polyline points='16,8 20,12 16,16' fill='none' stroke='%23fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></g></svg>") 12 12, move`;
}

export function OcrBboxEditOverlay({
  ocrResults,
  editingOcrId,
  photoWidth,
  photoHeight,
  imgRef,
  onBboxChange,
  orientation,
}: {
  ocrResults: PhotoOcrResultItem[];
  editingOcrId: string;
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  onBboxChange?: (
    bbox: {
      x: number;
      y: number;
      w: number;
      h: number;
      angle?: number;
      corners?: [number, number][];
    } | null,
  ) => void;
  orientation?: number | null;
}) {
  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;
  const imgRect = useImgRect(imgRef, dispW, dispH);
  const r = ocrResults.find((o) => o.id === editingOcrId);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Determine if this result uses quad corners
  const hasQuadCorners = r?.corners && r.corners.length === 4;

  // ── Quad mode state (always used — rect params are converted to corners) ──
  // localCorners are in DISPLAY space for correct drag behavior
  const [localCorners, setLocalCorners] = useState<[number, number][] | null>(
    null,
  );
  const quadDragRef = useRef<{
    type: "corner" | "edge" | "rotate";
    idx: number;
    startMouse: { x: number; y: number };
    startCorners: [number, number][];
  } | null>(null);

  // Reset state when editing target changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: editingOcrId is the intentional trigger
  useEffect(() => {
    setLocalCorners(null);
    onBboxChange?.(null);
  }, [editingOcrId, onBboxChange]);

  if (
    !imgRect ||
    !r ||
    r.x == null ||
    r.y == null ||
    r.w == null ||
    r.h == null
  )
    return null;

  const scaleX = imgRect.w / dispW;
  const scaleY = imgRect.h / dispH;

  // ── Always use quad mode — compute corners from rect params if not stored ──
  // Transform raw-space corners to display space for rendering
  const storedPts = hasQuadCorners
    ? (transformCornersForOrientation(
        r.corners as [number, number][],
        photoWidth,
        photoHeight,
        orientation,
      ) as [number, number][])
    : null;

  // Compute corners from x,y,w,h,angle in raw space, then transform to display
  const computedPts = (): [number, number][] => {
    const cx = r.x! + r.w! / 2;
    const cy = r.y! + r.h! / 2;
    const hw = r.w! / 2;
    const hh = r.h! / 2;
    const rad = ((r.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // [TL, TR, BR, BL] in raw space
    const rawPts: [number, number][] = [
      [cx + -hw * cos - -hh * sin, cy + -hw * sin + -hh * cos],
      [cx + hw * cos - -hh * sin, cy + hw * sin + -hh * cos],
      [cx + hw * cos - hh * sin, cy + hw * sin + hh * cos],
      [cx + -hw * cos - hh * sin, cy + -hw * sin + hh * cos],
    ];
    return transformCornersForOrientation(
      rawPts,
      photoWidth,
      photoHeight,
      orientation,
    ) as [number, number][];
  };

  const pts: [number, number][] = localCorners ?? storedPts ?? computedPts();

  // Emit change: reverse-transform display-space corners to raw space for DB
  const emitChange = (displayPts: [number, number][]) => {
    const rawPts = inverseTransformCornersForOrientation(
      displayPts,
      photoWidth,
      photoHeight,
      orientation,
    ) as [number, number][];
    const xs = rawPts.map(([x]) => x);
    const ys = rawPts.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    onBboxChange?.({
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      corners: rawPts,
    });
  };

  // Centroid of quad (rotation pivot)
  const centroid: [number, number] = [
    (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4,
    (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4,
  ];

  const handleQuadPointerDown = (
    type: "corner" | "edge" | "rotate",
    idx: number,
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    quadDragRef.current = {
      type,
      idx,
      startMouse: { x: e.clientX, y: e.clientY },
      startCorners: pts.map(([x, y]) => [x, y] as [number, number]),
    };
  };

  const handleQuadPointerMove = (e: React.PointerEvent) => {
    if (!quadDragRef.current) return;
    e.preventDefault();
    const { type, idx, startMouse, startCorners } = quadDragRef.current;
    const dxPhoto = (e.clientX - startMouse.x) / scaleX;
    const dyPhoto = (e.clientY - startMouse.y) / scaleY;

    if (type === "corner") {
      const newPts = startCorners.map(
        ([x, y], i) =>
          (i === idx ? [x + dxPhoto, y + dyPhoto] : [x, y]) as [number, number],
      );
      setLocalCorners(newPts);
      emitChange(newPts);
    } else if (type === "edge") {
      // Edge drag: slide both endpoints along the edge's tangent direction
      const [ei, ej] = QUAD_EDGES[idx];
      const edgeDx = startCorners[ej][0] - startCorners[ei][0];
      const edgeDy = startCorners[ej][1] - startCorners[ei][1];
      const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
      if (edgeLen < 1e-6) return;
      const tx = edgeDx / edgeLen;
      const ty = edgeDy / edgeLen;
      const proj = dxPhoto * tx + dyPhoto * ty;
      const newPts = startCorners.map(
        ([x, y], i) =>
          (i === ei || i === ej ? [x + proj * tx, y + proj * ty] : [x, y]) as [
            number,
            number,
          ],
      );
      setLocalCorners(newPts);
      emitChange(newPts);
    } else {
      // Rotate all corners around centroid
      const cx =
        (startCorners[0][0] +
          startCorners[1][0] +
          startCorners[2][0] +
          startCorners[3][0]) /
        4;
      const cy =
        (startCorners[0][1] +
          startCorners[1][1] +
          startCorners[2][1] +
          startCorners[3][1]) /
        4;
      // Use screen-space for angle calc (accounts for non-uniform scale)
      const cxS = cx * scaleX;
      const cyS = cy * scaleY;
      const rect = overlayRef.current?.getBoundingClientRect();
      const offX = rect?.left ?? 0;
      const offY = rect?.top ?? 0;
      const mouseAngle = Math.atan2(
        e.clientX - (offX + cxS),
        -(e.clientY - (offY + cyS)),
      );
      const startMouseAngle = Math.atan2(
        startMouse.x - (offX + cxS),
        -(startMouse.y - (offY + cyS)),
      );
      const deltaRad = mouseAngle - startMouseAngle;
      const cosD = Math.cos(deltaRad);
      const sinD = Math.sin(deltaRad);
      const newPts = startCorners.map(([x, y]) => {
        const dx = x - cx;
        const dy = y - cy;
        return [cx + dx * cosD - dy * sinD, cy + dx * sinD + dy * cosD] as [
          number,
          number,
        ];
      });
      setLocalCorners(newPts);
      emitChange(newPts);
    }
  };

  const handleQuadPointerUp = () => {
    quadDragRef.current = null;
  };

  const svgPoints = pts
    .map(([x, y]) => `${x * scaleX},${y * scaleY}`)
    .join(" ");

  // Rotation handle: above top edge midpoint, offset along outward normal
  const topMidX = ((pts[0][0] + pts[1][0]) / 2) * scaleX;
  const topMidY = ((pts[0][1] + pts[1][1]) / 2) * scaleY;
  const topEdgeDx = pts[1][0] * scaleX - pts[0][0] * scaleX;
  const topEdgeDy = pts[1][1] * scaleY - pts[0][1] * scaleY;
  const topEdgeLen = Math.sqrt(topEdgeDx * topEdgeDx + topEdgeDy * topEdgeDy);
  // Outward normal (perpendicular, pointing away from centroid)
  let normalX = topEdgeLen > 0 ? -topEdgeDy / topEdgeLen : 0;
  let normalY = topEdgeLen > 0 ? topEdgeDx / topEdgeLen : -1;
  const centroidSx = centroid[0] * scaleX;
  const centroidSy = centroid[1] * scaleY;
  if (normalX * (topMidX - centroidSx) + normalY * (topMidY - centroidSy) < 0) {
    normalX = -normalX;
    normalY = -normalY;
  }
  const rotHandleX = topMidX + normalX * ROTATION_ARM;
  const rotHandleY = topMidY + normalY * ROTATION_ARM;
  // Direction arrow midpoint on arm
  const arrowX = topMidX + normalX * ROTATION_ARM * 0.4;
  const arrowY = topMidY + normalY * ROTATION_ARM * 0.4;
  // Arrow rotation: perpendicular to arm pointing "down" toward the quad
  const armAngleDeg = Math.atan2(normalY, normalX) * (180 / Math.PI) + 90;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag overlay
    <div
      ref={overlayRef}
      className="absolute"
      style={{
        left: imgRect.offsetX,
        top: imgRect.offsetY,
        width: imgRect.w,
        height: imgRect.h,
      }}
      onPointerMove={handleQuadPointerMove}
      onPointerUp={handleQuadPointerUp}
    >
      <svg
        className="absolute left-0 top-0"
        width={imgRect.w}
        height={imgRect.h}
        style={{ overflow: "visible" }}
      >
        <polygon
          points={svgPoints}
          fill="rgba(251,191,36,0.1)"
          stroke="rgb(251,191,36)"
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />
        {/* Edge drag hit areas — pointerEvents="all" to catch transparent strokes */}
        {QUAD_EDGES.map(([ei, ej], edgeIdx) => {
          const x1 = pts[ei][0] * scaleX;
          const y1 = pts[ei][1] * scaleY;
          const x2 = pts[ej][0] * scaleX;
          const y2 = pts[ej][1] * scaleY;
          const edgeKey = (["top", "right", "bottom", "left"] as const)[
            edgeIdx
          ];
          return (
            <line
              key={edgeKey}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="transparent"
              strokeWidth={14}
              pointerEvents="all"
              style={{ cursor: edgeCursor(x1, y1, x2, y2) }}
              onPointerDown={(e) => handleQuadPointerDown("edge", edgeIdx, e)}
            />
          );
        })}
        {/* Rotation arm line */}
        <line
          x1={topMidX}
          y1={topMidY}
          x2={rotHandleX}
          y2={rotHandleY}
          stroke="rgba(251,191,36,0.5)"
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />
        {/* Text direction arrow on arm */}
        <g
          transform={`translate(${arrowX},${arrowY}) rotate(${armAngleDeg})`}
          style={{ pointerEvents: "none" }}
        >
          <polygon points="0,-4 3.5,3 -3.5,3" fill="rgba(251,191,36,0.55)" />
        </g>
      </svg>
      {/* Corner handles */}
      {pts.map(([px, py], idx) => {
        const cornerKey = (["tl", "tr", "br", "bl"] as const)[idx];
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: drag handle
          <div
            key={cornerKey}
            className="absolute z-10 rounded-full border-2 border-amber-400 bg-white shadow-md"
            style={{
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              left: px * scaleX - HANDLE_HALF,
              top: py * scaleY - HANDLE_HALF,
              cursor: "move",
            }}
            onPointerDown={(e) => handleQuadPointerDown("corner", idx, e)}
          />
        );
      })}
      {/* Rotation handle */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: rotation handle */}
      <div
        className="absolute z-10 rounded-full border-2 border-amber-400 bg-amber-400 shadow-md"
        style={{
          width: HANDLE_SIZE + 2,
          height: HANDLE_SIZE + 2,
          left: rotHandleX - (HANDLE_SIZE + 2) / 2,
          top: rotHandleY - (HANDLE_SIZE + 2) / 2,
          cursor: ROTATE_CURSOR,
        }}
        onPointerDown={(e) => handleQuadPointerDown("rotate", 0, e)}
      />
    </div>
  );
}

// ── OCR Character-level Selection Layer ─────────────────────────────────────

// Lazy-loaded WASM module
let _wasmPromise: Promise<typeof import("@tokiomo/tokimo-wasm")> | null = null;
function loadWasm() {
  if (!_wasmPromise) {
    _wasmPromise = import("@tokiomo/tokimo-wasm");
  }
  return _wasmPromise;
}

// Shared Canvas context for measuring character reference widths
let _measureCtx:
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D
  | null = null;
function getMeasureCtx() {
  if (_measureCtx) return _measureCtx;
  if (typeof OffscreenCanvas !== "undefined") {
    _measureCtx = new OffscreenCanvas(1, 1).getContext("2d");
  } else {
    _measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (_measureCtx) _measureCtx.font = "16px sans-serif";
  return _measureCtx;
}

interface OcrTextAnchor {
  blockIdx: number;
  charIdx: number;
}

/** Minimal block info kept in JS for rendering zoomed hit areas */
interface OcrBlockRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  charCount: number;
}

function normalizeOcrAnchors(
  engine: OcrEngine,
  a: OcrTextAnchor,
  b: OcrTextAnchor,
): {
  sBlock: number;
  sChar: number;
  eBlock: number;
  eChar: number;
  sRank: number;
  eRank: number;
} {
  const aRank = engine.visualRank(a.blockIdx);
  const bRank = engine.visualRank(b.blockIdx);
  if (aRank < bRank || (aRank === bRank && a.charIdx <= b.charIdx)) {
    return {
      sBlock: a.blockIdx,
      sChar: a.charIdx,
      eBlock: b.blockIdx,
      eChar: b.charIdx,
      sRank: aRank,
      eRank: bRank,
    };
  }
  return {
    sBlock: b.blockIdx,
    sChar: b.charIdx,
    eBlock: a.blockIdx,
    eChar: a.charIdx,
    sRank: bRank,
    eRank: aRank,
  };
}

/**
 * Hook: manages an OcrEngine instance, syncs blocks when data changes.
 * Returns engine ref + block rects (for rendering hit areas in zoomed mode).
 */
function useOcrEngine(
  ocrResults: PhotoOcrResultItem[],
  imgRect: ImgRect | null,
  photoWidth: number,
  photoHeight: number,
  orientation?: number | null,
) {
  const engineRef = useRef<OcrEngine | null>(null);
  const [ready, setReady] = useState(false);

  // Lazy-load WASM module
  useEffect(() => {
    loadWasm().then(({ OcrEngine: Ctor }) => {
      engineRef.current = new Ctor();
      setReady(true);
    });
  }, []);

  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;

  // Filter + sort results (stable ref via useMemo)
  const sorted = useMemo(
    () =>
      [...ocrResults]
        .filter((r) => r.x != null && r.y != null && r.w != null && r.h != null)
        .sort((a, b) => {
          const dy = (a.y ?? 0) - (b.y ?? 0);
          return Math.abs(dy) > 5 ? dy : (a.x ?? 0) - (b.x ?? 0);
        }),
    [ocrResults],
  );

  // Sync blocks to WASM engine whenever data changes
  const blockRects = useMemo(() => {
    if (!ready) return [];
    const engine = engineRef.current;
    if (!engine || !imgRect || sorted.length === 0) return [];

    const scX = imgRect.w / dispW;
    const scY = imgRect.h / dispH;
    const ctx = getMeasureCtx();
    const texts: string[] = [];
    const dataChunks: number[] = [];
    const rects: OcrBlockRect[] = [];

    // Determine if ANY block has matching backend char positions.
    // All blocks must use the same format (backend: N*2 values, or measureText: N values)
    // to keep the flat buffer parseable by WASM.
    const hasBackendPositions = sorted.some((r) => {
      const n = Array.from(r.text).length;
      return r.charPositions && r.charPositions.length === n;
    });

    for (const r of sorted) {
      // Transform bbox from raw to display space, then scale to screen pixels
      const db = transformBboxForOrientation(
        {
          x: r.x as number,
          y: r.y as number,
          w: r.w as number,
          h: r.h as number,
          angle: r.angle ?? 0,
        },
        photoWidth,
        photoHeight,
        orientation,
      );

      // Normalize block so WASM "width" direction matches the on-screen text
      // direction. The backend stores charPositions along bbox.w, but after EXIF
      // rotation the text direction may end up along bbox.h. The WASM hit-test
      // uses local_x (0..bw) for character selection, so we swap w↔h and adjust
      // the angle to keep the visual block identical while aligning charPositions
      // with the actual text flow direction on screen.
      let dw = db.w;
      let dh = db.h;
      let dAngle = db.angle;
      let charPosScale = 1;
      let normAngle = ((db.angle % 360) + 360) % 360;
      if (normAngle > 180) normAngle -= 360;
      if (Math.abs(normAngle) > 45 && Math.abs(normAngle) < 135) {
        const oldW = dw;
        dw = dh;
        dh = oldW;
        dAngle = normAngle > 0 ? normAngle - 90 : normAngle + 90;
        charPosScale = dw / dh; // rescale charPositions from old w-range to new w-range
      }

      const dcx = db.x + db.w / 2;
      const dcy = db.y + db.h / 2;
      const bx = (dcx - dw / 2) * scX;
      const by = (dcy - dh / 2) * scY;
      const bw = dw * scX;
      const bh = dh * scY;
      const chars = Array.from(r.text);

      texts.push(r.text);

      const hasMatchingPos =
        r.charPositions && r.charPositions.length === chars.length;

      if (hasBackendPositions) {
        // All blocks push [x, w] pairs (N*2 values) for consistency
        dataChunks.push(
          bx,
          by,
          bw,
          bh,
          dAngle,
          r.paragraphId ?? 0,
          chars.length,
        );
        if (hasMatchingPos) {
          // charPositions are inline offsets within the block — scale proportionally
          const cpScale = scX * charPosScale;
          for (const cp of r.charPositions!) {
            dataChunks.push(cp.x * cpScale);
            dataChunks.push(cp.w * cpScale);
          }
        } else {
          // Synthesize [x, w] pairs from measureText proportional widths
          let rawWidths: number[];
          if (ctx) {
            rawWidths = chars.map((c) => ctx.measureText(c).width || 1);
          } else {
            rawWidths = chars.map(() => 1);
          }
          const totalRaw = rawWidths.reduce((s, v) => s + v, 0) || 1;
          let accX = 0;
          for (const rw of rawWidths) {
            const w = (rw / totalRaw) * bw;
            dataChunks.push(accX);
            dataChunks.push(w);
            accX += w;
          }
        }
      } else {
        // All blocks push raw measureText widths (N values)
        let charWidths: number[];
        if (ctx) {
          charWidths = chars.map((c) => ctx.measureText(c).width || 1);
        } else {
          charWidths = chars.map(() => 1);
        }
        dataChunks.push(
          bx,
          by,
          bw,
          bh,
          dAngle,
          r.paragraphId ?? 0,
          chars.length,
          ...charWidths,
        );
      }

      rects.push({
        id: r.id,
        x: bx,
        y: by,
        w: bw,
        h: bh,
        angle: dAngle,
        charCount: chars.length,
      });
    }

    engine.setBlocks(new Float32Array(dataChunks), texts, hasBackendPositions);

    return rects;
  }, [
    sorted,
    imgRect,
    dispW,
    dispH,
    photoWidth,
    photoHeight,
    orientation,
    ready,
  ]);

  return { engineRef, blockRects, ready };
}

export function OcrBlockSelectLayer({
  ocrResults,
  photoWidth,
  photoHeight,
  imgRef,
  isZoomed,
  onSelectionRanges,
  orientation,
}: {
  ocrResults: PhotoOcrResultItem[];
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  isZoomed?: boolean;
  onSelectionRanges?: (
    ranges: Map<string, { start: number; end: number }>,
  ) => void;
  orientation?: number | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;
  const imgRect = useImgRect(imgRef, dispW, dispH);
  const [selection, setSelection] = useState<{
    anchor: OcrTextAnchor;
    focus: OcrTextAnchor;
  } | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);
  /** Rotation angle (degrees) of the block where drag started; 0 for empty-space drags. */
  const dragAngleRef = useRef(0);

  const { engineRef, blockRects } = useOcrEngine(
    ocrResults,
    imgRect,
    photoWidth,
    photoHeight,
    orientation,
  );

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const getSelectedText = useCallback(() => {
    const sel = selectionRef.current;
    const engine = engineRef.current;
    if (!sel || !engine) return "";
    return engine.extractText(
      sel.anchor.blockIdx,
      sel.anchor.charIdx,
      sel.focus.blockIdx,
      sel.focus.charIdx,
    );
  }, [engineRef]);

  const handleCopy = useCallback(() => {
    const text = getSelectedText();
    if (text) navigator.clipboard.writeText(text);
    setMenuPos(null);
  }, [getSelectedText]);

  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        e.preventDefault();
        const text = getSelectedText();
        if (text) navigator.clipboard.writeText(text);
      }
      if (e.key === "Escape") {
        setSelection(null);
        setMenuPos(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, getSelectedText]);

  useEffect(() => {
    if (!onSelectionRanges) return;
    const engine = engineRef.current;
    if (!selection || !engine) {
      onSelectionRanges(new Map());
      return;
    }
    const { sBlock, sChar, eBlock, eChar, sRank, eRank } = normalizeOcrAnchors(
      engine,
      selection.anchor,
      selection.focus,
    );
    if (sBlock === eBlock && sChar === eChar) {
      onSelectionRanges(new Map());
      return;
    }
    const visualOrder = engine.getVisualOrder();
    const ranges = new Map<string, { start: number; end: number }>();
    for (let r = sRank; r <= eRank; r++) {
      const i = visualOrder[r];
      const b = blockRects[i];
      if (!b) continue;
      const from = i === sBlock ? sChar : 0;
      const to = i === eBlock ? eChar : b.charCount;
      if (from < to) ranges.set(b.id, { start: from, end: to });
    }
    onSelectionRanges(ranges);
  }, [selection, blockRects, onSelectionRanges, engineRef]);

  useEffect(() => {
    if (!menuPos) return;
    const onClick = () => setMenuPos(null);
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [menuPos]);

  // Compute highlights via WASM (must be before early returns)
  const highlights = useMemo(() => {
    const engine = engineRef.current;
    if (!selection || !engine) return [];
    const flat = engine.computeHighlights(
      selection.anchor.blockIdx,
      selection.anchor.charIdx,
      selection.focus.blockIdx,
      selection.focus.charIdx,
    );
    const out: {
      x: number;
      y: number;
      w: number;
      h: number;
      angle: number;
      ox: number;
      oy: number;
      key: string;
    }[] = [];
    for (let i = 0; i < flat.length; i += 7) {
      out.push({
        x: flat[i],
        y: flat[i + 1],
        w: flat[i + 2],
        h: flat[i + 3],
        angle: flat[i + 4],
        ox: flat[i + 5],
        oy: flat[i + 6],
        key: `hl-${i}`,
      });
    }
    return out;
  }, [selection, engineRef]);

  if (!imgRect) return null;

  const engine = engineRef.current;
  if (!engine) return null;

  const getLayerCoords = (e: React.MouseEvent) => {
    const layer = layerRef.current;
    if (!layer) return { x: 0, y: 0 };
    const rect = layer.getBoundingClientRect();
    const cssW = imgRect?.w ?? rect.width;
    const cssH = imgRect?.h ?? rect.height;
    const sx = rect.width / cssW;
    const sy = rect.height / cssH;
    return { x: (e.clientX - rect.left) / sx, y: (e.clientY - rect.top) / sy };
  };

  const wasmHitTest = (
    px: number,
    py: number,
    anchorIdx: number,
  ): OcrTextAnchor | null => {
    const result = engine.hitTest(px, py, anchorIdx);
    if (result == null) return null;
    const r = result as { blockIdx: number; charIdx: number };
    return { blockIdx: r.blockIdx, charIdx: r.charIdx };
  };

  const hitBlockIdx = (px: number, py: number) =>
    blockRects.findIndex((b) => {
      // Rotate point into block-local coordinates for angled blocks
      let lx = px;
      let ly = py;
      if (b.angle) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const rad = (-b.angle * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = px - cx;
        const dy = py - cy;
        lx = dx * cos - dy * sin + cx;
        ly = dx * sin + dy * cos + cy;
      }
      return lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + b.h;
    });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenuPos(null);
    const { x, y } = getLayerCoords(e);
    const hit = wasmHitTest(x, y, -1);
    const idx = hitBlockIdx(x, y);
    if (idx >= 0 && hit) {
      engine.recomputeVisualOrder(idx);
      setSelection({ anchor: hit, focus: hit });
      dragOriginRef.current = { x, y };
      dragAngleRef.current = blockRects[idx].angle;
      isDraggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    } else if (isZoomed) {
      setSelection(null);
    } else {
      setSelection(null);
      dragOriginRef.current = { x, y };
      dragAngleRef.current = 0;
      isDraggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const { x, y } = getLayerCoords(e);
    const sel = selectionRef.current;
    const origin = dragOriginRef.current;
    if (!sel && origin) {
      const hit = wasmHitTest(x, y, -1);
      const hitIdx = hitBlockIdx(x, y);
      if (hit && hitIdx >= 0) {
        engine.recomputeVisualOrder(hitIdx);
        setSelection({ anchor: hit, focus: hit });
      }
    } else if (sel && origin) {
      // Build drag rectangle in a coordinate frame rotated to match the
      // initial text block's angle.  This prevents an axis-aligned rect
      // from accidentally sweeping across adjacent rotated text lines.
      const da = dragAngleRef.current;
      const rad = (-da * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      // Rotate current mouse position around the drag origin
      const dx = x - origin.x;
      const dy = y - origin.y;
      const rmx = dx * cosA - dy * sinA + origin.x;
      const rmy = dx * sinA + dy * cosA + origin.y;

      // AABB in the rotated frame
      const rx0 = Math.min(origin.x, rmx);
      const ry0 = Math.min(origin.y, rmy);
      const rx1 = Math.max(origin.x, rmx);
      const ry1 = Math.max(origin.y, rmy);

      let firstIdx = -1;
      for (let i = 0; i < blockRects.length; i++) {
        const b = blockRects[i];
        // Rotate block center into the drag frame
        const bcx = b.x + b.w / 2;
        const bcy = b.y + b.h / 2;
        const bdx = bcx - origin.x;
        const bdy = bcy - origin.y;
        const rbcx = bdx * cosA - bdy * sinA + origin.x;
        const rbcy = bdx * sinA + bdy * cosA + origin.y;

        // Block AABB in the rotated frame: use the block's relative angle
        const relRad = ((b.angle - da) * Math.PI) / 180;
        const cosR = Math.abs(Math.cos(relRad));
        const sinR = Math.abs(Math.sin(relRad));
        const hw = (b.w * cosR + b.h * sinR) / 2;
        const hh = (b.w * sinR + b.h * cosR) / 2;

        if (
          rbcx + hw > rx0 &&
          rbcx - hw < rx1 &&
          rbcy + hh > ry0 &&
          rbcy - hh < ry1
        ) {
          if (firstIdx < 0) firstIdx = i;
        }
      }

      if (firstIdx >= 0) {
        // Use original (unrotated) coords for character-level hit testing
        const startHit = wasmHitTest(origin.x, origin.y, -1);
        const endHit = wasmHitTest(x, y, -1);
        if (startHit && endHit) {
          setSelection({
            anchor:
              firstIdx === sel.anchor.blockIdx
                ? sel.anchor
                : { blockIdx: startHit.blockIdx, charIdx: startHit.charIdx },
            focus: { blockIdx: endHit.blockIdx, charIdx: endHit.charIdx },
          });
        }
      } else {
        const pos = wasmHitTest(x, y, sel.anchor.blockIdx);
        if (pos)
          setSelection((prev) =>
            prev ? { anchor: prev.anchor, focus: pos } : null,
          );
      }
    }
    e.stopPropagation();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    e.stopPropagation();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = getLayerCoords(e);
    const idx = hitBlockIdx(x, y);
    if (idx >= 0) {
      setSelection({
        anchor: { blockIdx: idx, charIdx: 0 },
        focus: { blockIdx: idx, charIdx: blockRects[idx].charCount },
      });
    }
    e.stopPropagation();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const { x, y } = getLayerCoords(e);
    const hasNonEmptySelection =
      selection &&
      !(
        selection.anchor.blockIdx === selection.focus.blockIdx &&
        selection.anchor.charIdx === selection.focus.charIdx
      );
    if (hasNonEmptySelection) {
      const idx = hitBlockIdx(x, y);
      const { sRank, eRank } = normalizeOcrAnchors(
        engine,
        selection.anchor,
        selection.focus,
      );
      const idxRank = idx >= 0 ? engine.visualRank(idx) : -1;
      if (idxRank >= sRank && idxRank <= eRank) {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
        return;
      }
    }
    const idx = hitBlockIdx(x, y);
    if (idx >= 0) {
      engine.recomputeVisualOrder(idx);
      setSelection({
        anchor: { blockIdx: idx, charIdx: 0 },
        focus: { blockIdx: idx, charIdx: blockRects[idx].charCount },
      });
      e.preventDefault();
      e.stopPropagation();
      setMenuPos({ x: e.clientX, y: e.clientY });
    }
  };

  return (
    <>
      <div
        ref={layerRef}
        role="application"
        className="absolute"
        style={{
          left: imgRect.offsetX,
          top: imgRect.offsetY,
          width: imgRect.w,
          height: imgRect.h,
          cursor: isZoomed ? "inherit" : "text",
          pointerEvents: isZoomed ? "none" : "auto",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {highlights.map((hl) => (
          <div
            key={hl.key}
            className="pointer-events-none absolute rounded-[2px]"
            style={{
              left: hl.x,
              top: hl.y,
              width: hl.w,
              height: hl.h,
              background: "rgba(56, 139, 253, 0.35)",
              transform: hl.angle ? `rotate(${hl.angle}deg)` : undefined,
              transformOrigin: `${hl.ox}px ${hl.oy}px`,
            }}
          />
        ))}
        {isZoomed &&
          blockRects.map((b) => (
            <div
              key={`hit-${b.id}`}
              role="application"
              className="absolute"
              style={{
                left: b.x,
                top: b.y,
                width: b.w,
                height: b.h,
                cursor: "text",
                pointerEvents: "auto",
                transform: b.angle ? `rotate(${b.angle}deg)` : undefined,
                transformOrigin: "center center",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
            />
          ))}
      </div>
      {menuPos &&
        selection &&
        createPortal(
          <div
            className="fixed z-[99999] min-w-[120px] rounded-md border border-white/20 bg-neutral-800 py-1 shadow-xl"
            style={{ left: menuPos.x, top: menuPos.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-white hover:bg-white/10"
              onClick={handleCopy}
            >
              复制文字
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
