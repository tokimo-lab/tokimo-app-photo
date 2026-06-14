import { useEffect, useRef, useState } from "react";
import type { PhotoOcrResultItem } from "../generated/rust-api";
import { useImgRect } from "./photo-overlays";
import {
  inverseTransformCornersForOrientation,
  isOrientationSwapped,
  transformCornersForOrientation,
} from "./photo-utils";

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
