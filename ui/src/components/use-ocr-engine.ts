import { useMemo, useRef } from "react";
import type { PhotoOcrResultItem } from "@/generated/rust-api";
import type { ImgRect } from "./photo-overlays";
import {
  isOrientationSwapped,
  transformBboxForOrientation,
} from "./photo-utils";

export interface OcrTextAnchor {
  blockIdx: number;
  charIdx: number;
}

export interface OcrBlockRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  charCount: number;
}

interface OcrEngineLike {
  visualRank: (blockIdx: number) => number;
  getVisualOrder: () => number[];
  extractText: (
    aBlock: number,
    aChar: number,
    bBlock: number,
    bChar: number,
  ) => string;
  computeHighlights: (
    aBlock: number,
    aChar: number,
    bBlock: number,
    bChar: number,
  ) => number[];
  hitTest: (x: number, y: number, anchorIdx: number) => OcrTextAnchor | null;
  recomputeVisualOrder: (anchorIdx: number) => void;
  setBlocks: (blocks: OcrBlockRect[], texts: string[]) => void;
}

class JsOcrEngine implements OcrEngineLike {
  private blocks: OcrBlockRect[] = [];
  private texts: string[] = [];
  private order: number[] = [];

  setBlocks(blocks: OcrBlockRect[], texts: string[]) {
    this.blocks = blocks;
    this.texts = texts;
    this.order = blocks
      .map((_, index) => index)
      .sort((a, b) => {
        const dy = blocks[a].y - blocks[b].y;
        return Math.abs(dy) > 8 ? dy : blocks[a].x - blocks[b].x;
      });
  }

  visualRank(blockIdx: number) {
    const rank = this.order.indexOf(blockIdx);
    return rank >= 0 ? rank : blockIdx;
  }

  getVisualOrder() {
    return this.order;
  }

  recomputeVisualOrder(_anchorIdx: number) {
    this.setBlocks(this.blocks, this.texts);
  }

  extractText(aBlock: number, aChar: number, bBlock: number, bChar: number) {
    const range = normalizeOcrAnchors(
      this,
      { blockIdx: aBlock, charIdx: aChar },
      { blockIdx: bBlock, charIdx: bChar },
    );
    const chunks: string[] = [];
    for (let rank = range.sRank; rank <= range.eRank; rank++) {
      const idx = this.order[rank];
      const text = this.texts[idx] ?? "";
      const from = idx === range.sBlock ? range.sChar : 0;
      const to = idx === range.eBlock ? range.eChar : Array.from(text).length;
      chunks.push(Array.from(text).slice(from, to).join(""));
    }
    return chunks.join("\n");
  }

  computeHighlights(
    aBlock: number,
    aChar: number,
    bBlock: number,
    bChar: number,
  ) {
    const range = normalizeOcrAnchors(
      this,
      { blockIdx: aBlock, charIdx: aChar },
      { blockIdx: bBlock, charIdx: bChar },
    );
    const out: number[] = [];
    for (let rank = range.sRank; rank <= range.eRank; rank++) {
      const idx = this.order[rank];
      const block = this.blocks[idx];
      if (!block) continue;
      const textLength = Math.max(block.charCount, 1);
      const from = idx === range.sBlock ? range.sChar : 0;
      const to = idx === range.eBlock ? range.eChar : textLength;
      if (to <= from) continue;
      const x = block.x + (block.w * from) / textLength;
      const w = (block.w * (to - from)) / textLength;
      out.push(x, block.y, w, block.h, block.angle, block.w / 2, block.h / 2);
    }
    return out;
  }

  hitTest(x: number, y: number) {
    const idx = this.blocks.findIndex(
      (block) =>
        x >= block.x &&
        x <= block.x + block.w &&
        y >= block.y &&
        y <= block.y + block.h,
    );
    if (idx < 0) return null;
    const block = this.blocks[idx];
    const charIdx = Math.max(
      0,
      Math.min(
        block.charCount,
        Math.round(((x - block.x) / Math.max(block.w, 1)) * block.charCount),
      ),
    );
    return { blockIdx: idx, charIdx };
  }
}

export function normalizeOcrAnchors(
  engine: Pick<OcrEngineLike, "visualRank">,
  a: OcrTextAnchor,
  b: OcrTextAnchor,
) {
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

export function useOcrEngine(
  ocrResults: PhotoOcrResultItem[],
  imgRect: ImgRect | null,
  photoWidth: number,
  photoHeight: number,
  orientation?: number | null,
) {
  const engineRef = useRef<OcrEngineLike | null>(null);
  if (!engineRef.current) engineRef.current = new JsOcrEngine();

  const swapped = isOrientationSwapped(orientation);
  const dispW = swapped ? photoHeight : photoWidth;
  const dispH = swapped ? photoWidth : photoHeight;

  const blockRects = useMemo(() => {
    if (!imgRect || dispW <= 0 || dispH <= 0) return [];
    const scX = imgRect.w / dispW;
    const scY = imgRect.h / dispH;
    const sorted = [...ocrResults]
      .filter((r) => r.x != null && r.y != null && r.w != null && r.h != null)
      .sort((a, b) =>
        Math.abs((a.y ?? 0) - (b.y ?? 0)) > 5
          ? (a.y ?? 0) - (b.y ?? 0)
          : (a.x ?? 0) - (b.x ?? 0),
      );
    const rects = sorted.map((r) => {
      const db = transformBboxForOrientation(
        {
          x: r.x ?? 0,
          y: r.y ?? 0,
          w: r.w ?? 0,
          h: r.h ?? 0,
          angle: r.angle ?? 0,
        },
        photoWidth,
        photoHeight,
        orientation,
      );
      return {
        id: r.id,
        x: db.x * scX,
        y: db.y * scY,
        w: db.w * scX,
        h: db.h * scY,
        angle: db.angle,
        charCount: Array.from(r.text).length,
      };
    });
    engineRef.current?.setBlocks(
      rects,
      sorted.map((r) => r.text),
    );
    return rects;
  }, [ocrResults, imgRect, dispW, dispH, photoWidth, photoHeight, orientation]);

  return { engineRef, blockRects, ready: true };
}
