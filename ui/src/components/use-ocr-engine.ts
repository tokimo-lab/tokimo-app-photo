import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOcrResultItem } from "../generated/rust-api";
import type { ImgRect } from "./photo-overlays";
import {
  isOrientationSwapped,
  transformBboxForOrientation,
} from "./photo-utils";

type WasmModule = typeof import("../../public/wasm/tokimo_app_photo_wasm");

let _wasmPromise: Promise<WasmModule> | null = null;
function loadWasm(): Promise<WasmModule> {
  if (!_wasmPromise) {
    const wb = (globalThis as unknown as { wasm_bindgen?: WasmModule & ((wasmUrl: string) => Promise<unknown>) }).wasm_bindgen;
    if (wb && typeof wb.OcrEngine === 'function') {
      _wasmPromise = Promise.resolve(wb);
    } else {
      _wasmPromise = new Promise<WasmModule>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "./wasm/tokimo_app_photo_wasm.js";
        script.onload = () => {
          const wb2 = (globalThis as unknown as { wasm_bindgen: WasmModule & ((wasmUrl: string) => Promise<unknown>) }).wasm_bindgen;
          (wb2 as unknown as (wasmUrl: string) => Promise<unknown>)("./wasm/tokimo_app_photo_wasm_bg.wasm")
            .then(() => resolve(wb2))
            .catch(reject);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
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

export interface OcrTextAnchor {
  blockIdx: number;
  charIdx: number;
}

/** Minimal block info kept in JS for rendering zoomed hit areas */
export interface OcrBlockRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  charCount: number;
}

export function normalizeOcrAnchors(
  engine: WasmModule["OcrEngine"],
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
export function useOcrEngine(
  ocrResults: PhotoOcrResultItem[],
  imgRect: ImgRect | null,
  photoWidth: number,
  photoHeight: number,
  orientation?: number | null,
) {
  const engineRef = useRef<WasmModule["OcrEngine"] | null>(null);
  const [ready, setReady] = useState(() => {
    const wb = (globalThis as unknown as { wasm_bindgen?: WasmModule }).wasm_bindgen;
    if (wb && typeof wb.OcrEngine === 'function') {
      engineRef.current = new wb.OcrEngine();
      return true;
    }
    return false;
  });

  // Lazy-load WASM module (only if not already loaded synchronously)
  useEffect(() => {
    if (ready) return;
    loadWasm().then(({ OcrEngine: Ctor }) => {
      engineRef.current = new Ctor();
      setReady(true);
    });
  }, [ready]);

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

      // Normalize block so WASM "width" direction matches the text direction.
      //
      // The backend's crop_rotated_text_region() rotates tall crops (h/w >= 1.5)
      // by 90° CW so the recognizer sees horizontal text, but recognize_text()
      // still computes charPositions using bbox.w (the short perpendicular side).
      // This means charPositions span ~w pixels when they should span ~h pixels.
      //
      // Fix: when h >= w * 1.5, swap w↔h and subtract 90° from the angle.
      // This keeps the visual rectangle identical while making the WASM's width
      // (and thus local_x hit-test range) match the actual text direction.
      // CharPositions are rescaled by h/w to span the correct range.
      //
      // This handles ALL EXIF orientations (90°/180°/270° + flips) plus
      // non-EXIF vertical text uniformly — the condition depends on the raw
      // block aspect ratio, not the display angle.
      let dw = db.w;
      let dh = db.h;
      let dAngle = db.angle;
      let charPosScale = 1;
      if (db.h >= db.w * 1.5 && db.w > 0) {
        const oldW = dw;
        dw = dh;
        dh = oldW;
        let normAngle = ((db.angle % 360) + 360) % 360;
        if (normAngle > 180) normAngle -= 360;
        dAngle = normAngle >= 0 ? normAngle - 90 : normAngle + 90;
        charPosScale = dw / dh; // = h/w, rescale charPositions from w-range to h-range
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
