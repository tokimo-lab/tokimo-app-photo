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
}: {
  faces: PhotoFaceOutput[];
  hoveredFaceId: number;
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
}) {
  const imgRect = useImgRect(imgRef, photoWidth, photoHeight);
  if (!imgRect) return null;

  const scaleX = imgRect.w / photoWidth;
  const scaleY = imgRect.h / photoHeight;

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

        const pad = Math.max(face.w, face.h) * 0.15;
        return (
          <div
            key={face.id}
            className="absolute rounded-md border-2 border-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.4)]"
            style={{
              left: (face.x - pad) * scaleX,
              top: (face.y - pad) * scaleY,
              width: (face.w + pad * 2) * scaleX,
              height: (face.h + pad * 2) * scaleY,
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
}: {
  ocrResults: PhotoOcrResultItem[];
  hoveredOcrId: string;
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
}) {
  const imgRect = useImgRect(imgRef, photoWidth, photoHeight);
  if (!imgRect) return null;

  const scaleX = imgRect.w / photoWidth;
  const scaleY = imgRect.h / photoHeight;

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

        const pad = 0;
        const angle = r.angle ?? 0;
        return (
          <div
            key={r.id}
            className="absolute rounded border-2 border-emerald-400 bg-emerald-400/15 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
            style={{
              left: r.x * scaleX - pad,
              top: r.y * scaleY - pad,
              width: r.w * scaleX + pad * 2,
              height: r.h * scaleY + pad * 2,
              transform: angle ? `rotate(${angle}deg)` : undefined,
              transformOrigin: "center center",
            }}
          />
        );
      })}
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
  a: OcrTextAnchor,
  b: OcrTextAnchor,
): { sBlock: number; sChar: number; eBlock: number; eChar: number } {
  if (
    a.blockIdx < b.blockIdx ||
    (a.blockIdx === b.blockIdx && a.charIdx <= b.charIdx)
  ) {
    return {
      sBlock: a.blockIdx,
      sChar: a.charIdx,
      eBlock: b.blockIdx,
      eChar: b.charIdx,
    };
  }
  return {
    sBlock: b.blockIdx,
    sChar: b.charIdx,
    eBlock: a.blockIdx,
    eChar: a.charIdx,
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

    const scX = imgRect.w / photoWidth;
    const scY = imgRect.h / photoHeight;
    const ctx = getMeasureCtx();
    const texts: string[] = [];
    const dataChunks: number[] = [];
    const rects: OcrBlockRect[] = [];

    let hasBackendPositions = false;

    for (const r of sorted) {
      const bw = (r.w as number) * scX;
      const bh = (r.h as number) * scY;
      const bx = (r.x as number) * scX;
      const by = (r.y as number) * scY;
      const chars = Array.from(r.text);

      texts.push(r.text);

      if (r.charPositions && r.charPositions.length === chars.length) {
        // Backend provides char_positions (CTC alignment or Attention model)
        // cp.x is already relative to block origin; just scale to CSS pixels
        hasBackendPositions = true;
        dataChunks.push(
          bx,
          by,
          bw,
          bh,
          r.angle ?? 0,
          r.paragraphId ?? 0,
          chars.length,
        );
        for (const cp of r.charPositions) {
          dataChunks.push(cp.x * scX); // x relative to block, scaled
          dataChunks.push(cp.w * scX); // width, scaled
        }
      } else {
        // Fallback: Canvas measureText proportional estimation
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
          r.angle ?? 0,
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
        angle: r.angle ?? 0,
        charCount: chars.length,
      });
    }

    engine.setBlocks(new Float32Array(dataChunks), texts, hasBackendPositions);

    return rects;
  }, [sorted, imgRect, photoWidth, photoHeight, ready]); // ready triggers re-sync after WASM loads

  return { engineRef, blockRects, ready };
}

export function OcrBlockSelectLayer({
  ocrResults,
  photoWidth,
  photoHeight,
  imgRef,
  isZoomed,
  onSelectionRanges,
}: {
  ocrResults: PhotoOcrResultItem[];
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
  isZoomed?: boolean;
  onSelectionRanges?: (
    ranges: Map<string, { start: number; end: number }>,
  ) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const imgRect = useImgRect(imgRef, photoWidth, photoHeight);
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
    if (!selection) {
      onSelectionRanges(new Map());
      return;
    }
    const { sBlock, sChar, eBlock, eChar } = normalizeOcrAnchors(
      selection.anchor,
      selection.focus,
    );
    if (sBlock === eBlock && sChar === eChar) {
      onSelectionRanges(new Map());
      return;
    }
    const ranges = new Map<string, { start: number; end: number }>();
    for (let i = sBlock; i <= eBlock; i++) {
      const b = blockRects[i];
      if (!b) continue;
      const from = i === sBlock ? sChar : 0;
      const to = i === eBlock ? eChar : b.charCount;
      if (from < to) ranges.set(b.id, { start: from, end: to });
    }
    onSelectionRanges(ranges);
  }, [selection, blockRects, onSelectionRanges]);

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
      if (hit && hitBlockIdx(x, y) >= 0) {
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
      const { sBlock, eBlock } = normalizeOcrAnchors(
        selection.anchor,
        selection.focus,
      );
      if (idx >= sBlock && idx <= eBlock) {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
        return;
      }
    }
    const idx = hitBlockIdx(x, y);
    if (idx >= 0) {
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
