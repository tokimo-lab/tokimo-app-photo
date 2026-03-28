/**
 * Shared overlay components for photo viewing (used by both
 * PhotoLightbox and PhotoWindowViewer).
 *
 * Extracted to avoid duplication between fullscreen and windowed viewers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PhotoFaceOutput,
  PhotoOcrResultItem,
} from "../../generated/rust-api";

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
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const imgAspect = photoWidth / photoHeight;
      const elemAspect = rect.width / rect.height;

      let renderedW: number;
      let renderedH: number;
      if (imgAspect > elemAspect) {
        renderedW = rect.width;
        renderedH = rect.width / imgAspect;
      } else {
        renderedH = rect.height;
        renderedW = rect.height * imgAspect;
      }

      setImgRect({
        w: renderedW,
        h: renderedH,
        offsetX: (rect.width - renderedW) / 2,
        offsetY: (rect.height - renderedH) / 2,
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

        const pad = 4;
        return (
          <div
            key={r.id}
            className="absolute rounded border-2 border-emerald-400 bg-emerald-400/15 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
            style={{
              left: r.x * scaleX - pad,
              top: r.y * scaleY - pad,
              width: r.w * scaleX + pad * 2,
              height: r.h * scaleY + pad * 2,
            }}
          />
        );
      })}
    </div>
  );
}

// ── OCR Character-level Selection Layer ─────────────────────────────────────

interface OcrCharPos {
  x: number;
  w: number;
}

interface OcrBlock {
  id: string;
  text: string;
  textChars: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  chars: OcrCharPos[];
  paragraphId: number;
}

interface OcrTextAnchor {
  blockIdx: number;
  charIdx: number;
}

function measureOcrCharPositions(
  text: string,
  blockW: number,
  _blockH: number,
): { chars: OcrCharPos[]; textChars: string[] } {
  const textChars = Array.from(text);
  if (textChars.length === 0) return { chars: [], textChars };
  const charW = blockW / textChars.length;
  const chars: OcrCharPos[] = textChars.map((_, i) => ({
    x: i * charW,
    w: charW,
  }));
  return { chars, textChars };
}

function ocrCharIdxAtX(chars: OcrCharPos[], localX: number): number {
  for (let i = 0; i < chars.length; i++) {
    if (localX < chars[i].x + chars[i].w / 2) return i;
  }
  return chars.length;
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

function ocrPositionAtPoint(
  blocks: OcrBlock[],
  px: number,
  py: number,
  anchorBlockIdx?: number,
): OcrTextAnchor | null {
  if (blocks.length === 0) return null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
      return { blockIdx: i, charIdx: ocrCharIdxAtX(b.chars, px - b.x) };
    }
  }
  const anchorB = anchorBlockIdx != null ? blocks[anchorBlockIdx] : null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestIdx = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const vd = py < b.y ? b.y - py : py > b.y + b.h ? py - b.y - b.h : 0;
    const hd = px < b.x ? b.x - px : px > b.x + b.w ? px - b.x - b.w : 0;
    let d = vd * 3 + hd;
    if (anchorB) {
      const sameParagraph =
        anchorB.paragraphId > 0 && b.paragraphId > 0
          ? b.paragraphId === anchorB.paragraphId
          : b.x < anchorB.x + anchorB.w && b.x + b.w > anchorB.x;
      if (!sameParagraph) d += 10000;
    }
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  const b = blocks[bestIdx];
  if (px <= b.x) return { blockIdx: bestIdx, charIdx: 0 };
  if (px >= b.x + b.w)
    return { blockIdx: bestIdx, charIdx: b.textChars.length };
  return { blockIdx: bestIdx, charIdx: ocrCharIdxAtX(b.chars, px - b.x) };
}

function extractOcrSelectedText(
  blocks: OcrBlock[],
  anchor: OcrTextAnchor,
  focus: OcrTextAnchor,
): string {
  const { sBlock, sChar, eBlock, eChar } = normalizeOcrAnchors(anchor, focus);
  if (sBlock === eBlock && sChar === eChar) return "";
  if (sBlock === eBlock) {
    return blocks[sBlock].textChars.slice(sChar, eChar).join("");
  }
  const parts: string[] = [];
  parts.push(blocks[sBlock].textChars.slice(sChar).join(""));
  for (let i = sBlock + 1; i < eBlock; i++) {
    parts.push(blocks[i].text);
  }
  parts.push(blocks[eBlock].textChars.slice(0, eChar).join(""));
  return parts.join("\n");
}

function computeOcrCharHighlights(
  blocks: OcrBlock[],
  anchor: OcrTextAnchor,
  focus: OcrTextAnchor,
): { x: number; y: number; w: number; h: number; key: string }[] {
  const { sBlock, sChar, eBlock, eChar } = normalizeOcrAnchors(anchor, focus);
  if (sBlock === eBlock && sChar === eChar) return [];
  const out: { x: number; y: number; w: number; h: number; key: string }[] = [];
  for (let i = sBlock; i <= eBlock; i++) {
    const b = blocks[i];
    if (b.chars.length === 0) continue;
    const from = i === sBlock ? sChar : 0;
    const to = i === eBlock ? eChar : b.textChars.length;
    if (from >= to) continue;
    const x0 = from < b.chars.length ? b.chars[from].x : b.w;
    const x1 = to >= b.chars.length ? b.w : b.chars[to].x;
    const vPad = b.h * 0.25;
    out.push({
      x: b.x + x0,
      y: b.y - vPad,
      w: x1 - x0,
      h: b.h + vPad * 2,
      key: `hl-${i}-${from}-${to}`,
    });
  }
  return out;
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

  const blocks = useMemo(() => {
    if (!imgRect) return [];
    const scX = imgRect.w / photoWidth;
    const scY = imgRect.h / photoHeight;
    return sorted.map((r): OcrBlock => {
      const bw = (r.w as number) * scX;
      const bh = (r.h as number) * scY;
      const { chars, textChars } = measureOcrCharPositions(r.text, bw, bh);
      return {
        id: r.id,
        text: r.text,
        textChars,
        x: (r.x as number) * scX,
        y: (r.y as number) * scY,
        w: bw,
        h: bh,
        chars,
        paragraphId: r.paragraphId ?? 0,
      };
    });
  }, [sorted, imgRect, photoWidth, photoHeight]);

  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const getSelectedText = useCallback(() => {
    const sel = selectionRef.current;
    const blks = blocksRef.current;
    if (!sel) return "";
    return extractOcrSelectedText(blks, sel.anchor, sel.focus);
  }, []);

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
      const b = blocks[i];
      const from = i === sBlock ? sChar : 0;
      const to = i === eBlock ? eChar : b.textChars.length;
      if (from < to) ranges.set(b.id, { start: from, end: to });
    }
    onSelectionRanges(ranges);
  }, [selection, blocks, onSelectionRanges]);

  useEffect(() => {
    if (!menuPos) return;
    const onClick = () => setMenuPos(null);
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [menuPos]);

  if (!imgRect) return null;

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

  const hitBlockIdx = (px: number, py: number) =>
    blocks.findIndex(
      (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h,
    );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMenuPos(null);
    const { x, y } = getLayerCoords(e);
    const idx = hitBlockIdx(x, y);
    if (idx >= 0) {
      const charIdx = ocrCharIdxAtX(blocks[idx].chars, x - blocks[idx].x);
      const anchor: OcrTextAnchor = { blockIdx: idx, charIdx };
      setSelection({ anchor, focus: anchor });
      dragOriginRef.current = { x, y };
      isDraggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
    } else if (isZoomed) {
      setSelection(null);
    } else {
      setSelection(null);
      dragOriginRef.current = { x, y };
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
      const idx = hitBlockIdx(x, y);
      if (idx >= 0) {
        const charIdx = ocrCharIdxAtX(blocks[idx].chars, x - blocks[idx].x);
        const anchor: OcrTextAnchor = { blockIdx: idx, charIdx };
        setSelection({ anchor, focus: anchor });
      }
    } else if (sel && origin) {
      const rx0 = Math.min(origin.x, x);
      const ry0 = Math.min(origin.y, y);
      const rx1 = Math.max(origin.x, x);
      const ry1 = Math.max(origin.y, y);

      let firstIdx = -1;
      let lastIdx = -1;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (b.x + b.w > rx0 && b.x < rx1 && b.y + b.h > ry0 && b.y < ry1) {
          if (firstIdx < 0) firstIdx = i;
          lastIdx = i;
        }
      }

      if (firstIdx >= 0) {
        const fb = blocks[firstIdx];
        const lb = blocks[lastIdx];
        const startChar =
          firstIdx === sel.anchor.blockIdx
            ? sel.anchor.charIdx
            : ocrCharIdxAtX(fb.chars, Math.max(0, rx0 - fb.x));
        const endChar = ocrCharIdxAtX(lb.chars, Math.min(lb.w, rx1 - lb.x));
        setSelection({
          anchor: { blockIdx: firstIdx, charIdx: startChar },
          focus: { blockIdx: lastIdx, charIdx: endChar },
        });
      } else {
        const pos = ocrPositionAtPoint(blocks, x, y, sel.anchor.blockIdx);
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
        focus: { blockIdx: idx, charIdx: blocks[idx].textChars.length },
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
        focus: { blockIdx: idx, charIdx: blocks[idx].textChars.length },
      });
      e.preventDefault();
      e.stopPropagation();
      setMenuPos({ x: e.clientX, y: e.clientY });
    }
  };

  const highlights = selection
    ? computeOcrCharHighlights(blocks, selection.anchor, selection.focus)
    : [];

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
            }}
          />
        ))}
        {isZoomed &&
          blocks.map((b) => (
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
