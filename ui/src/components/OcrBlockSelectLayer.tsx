import { useContextMenu } from "@tokimo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOcrResultItem } from "../generated/rust-api";
import { useImgRect } from "./photo-overlays";
import { isOrientationSwapped } from "./photo-utils";
import {
  normalizeOcrAnchors,
  type OcrTextAnchor,
  useOcrEngine,
} from "./use-ocr-engine";

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
  const { open: openCtxMenu, contextMenu } = useContextMenu();
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
        openCtxMenu(e, [
          { label: "复制文字", icon: "📋", onClick: handleCopy },
        ]);
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
      openCtxMenu(e, [
        { label: "复制文字", icon: "📋", onClick: handleCopy },
      ]);
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
      {contextMenu}
    </>
  );
}
