import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeInitialScale } from "./lightbox-utils";

const MAX_SCALE = 20;

function getPinchDist(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

interface ZoomPanOptions {
  photoDims: { width: number; height: number } | undefined;
  showInfo: boolean;
  imgRef: React.RefObject<HTMLImageElement | null>;
}

interface PinchState {
  startDist: number;
  startScale: number;
  startPanX: number;
  startPanY: number;
  midX: number;
  midY: number;
}

export function useLightboxZoomPan({
  photoDims,
  showInfo,
  imgRef,
}: ZoomPanOptions) {
  const initialScaleValue = useMemo(() => {
    if (!photoDims) return 1;
    return computeInitialScale(photoDims.width, photoDims.height, showInfo);
  }, [photoDims, showInfo]);

  const [scale, setScale] = useState(() => {
    if (!photoDims) return 1;
    return computeInitialScale(photoDims.width, photoDims.height, showInfo);
  });
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const isZoomed = scale > initialScaleValue + 0.01;

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;
  const initialScaleRef = useRef(initialScaleValue);
  initialScaleRef.current = initialScaleValue;

  // Pinch-to-zoom state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<PinchState | null>(null);

  // Pan boundary clamping — snaps back after drag ends or zoom changes
  useEffect(() => {
    if (dragging) return;
    const img = imgRef.current;
    const container = imageContainerRef.current;
    if (!img || !container) return;

    const styles = getComputedStyle(container);
    const cw =
      container.clientWidth -
      parseFloat(styles.paddingLeft) -
      parseFloat(styles.paddingRight);
    const ch =
      container.clientHeight -
      parseFloat(styles.paddingTop) -
      parseFloat(styles.paddingBottom);
    const iw = img.clientWidth * scale;
    const ih = img.clientHeight * scale;

    const overflows = iw > cw || ih > ch;
    if (!overflows) {
      if (panX !== 0 || panY !== 0) {
        setPanX(0);
        setPanY(0);
      }
      return;
    }

    const clamp = (p: number, imgSize: number, vp: number) => {
      if (imgSize <= vp) {
        const maxP = vp / 3;
        return Math.min(maxP, Math.max(-maxP, p));
      }
      const maxP = imgSize / 2 - vp / 6;
      return Math.min(maxP, Math.max(-maxP, p));
    };

    const cx = clamp(panX, iw, cw);
    const cy = clamp(panY, ih, ch);
    if (cx !== panX || cy !== panY) {
      setPanX(cx);
      setPanY(cy);
    }
  }, [scale, panX, panY, dragging, imgRef]);

  // Native wheel listener with cursor-relative zoom
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const getContentSize = () => {
      const s = getComputedStyle(container);
      return {
        w:
          container.clientWidth -
          parseFloat(s.paddingLeft) -
          parseFloat(s.paddingRight),
        h:
          container.clientHeight -
          parseFloat(s.paddingTop) -
          parseFloat(s.paddingBottom),
      };
    };

    const gaps = (pan: number, imgHalf: number, vpHalf: number) => ({
      lo: pan - imgHalf + vpHalf,
      hi: vpHalf - pan - imgHalf,
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const img = imgRef.current;
      if (!img) return;

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - (rect.left + rect.width / 2);
      const cursorY = e.clientY - (rect.top + rect.height / 2);

      const oldS = scaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newS = Math.min(
        MAX_SCALE,
        Math.max(initialScaleRef.current, oldS * factor),
      );
      if (newS === oldS) return;

      const ratio = 1 - newS / oldS;
      const oldPX = panXRef.current;
      const oldPY = panYRef.current;
      let nx = oldPX + (cursorX - oldPX) * ratio;
      let ny = oldPY + (cursorY - oldPY) * ratio;

      const vp = getContentSize();
      const imgW = img.clientWidth;
      const imgH = img.clientHeight;
      const oldIW = imgW * oldS;
      const oldIH = imgH * oldS;
      const newIW = imgW * newS;
      const newIH = imgH * newS;

      const zoomingIn = newS > oldS;

      if (zoomingIn) {
        const oldGX = gaps(oldPX, oldIW / 2, vp.w / 2);
        const oldGY = gaps(oldPY, oldIH / 2, vp.h / 2);

        const newGXlo = nx - newIW / 2 + vp.w / 2;
        if (oldGX.lo > 0 && newGXlo > oldGX.lo) nx -= newGXlo - oldGX.lo;
        const newGXhi = vp.w / 2 - nx - newIW / 2;
        if (oldGX.hi > 0 && newGXhi > oldGX.hi) nx += newGXhi - oldGX.hi;

        const newGYlo = ny - newIH / 2 + vp.h / 2;
        if (oldGY.lo > 0 && newGYlo > oldGY.lo) ny -= newGYlo - oldGY.lo;
        const newGYhi = vp.h / 2 - ny - newIH / 2;
        if (oldGY.hi > 0 && newGYhi > oldGY.hi) ny += newGYhi - oldGY.hi;
      } else {
        const overflows = newIW > vp.w || newIH > vp.h;
        if (!overflows) {
          nx = 0;
          ny = 0;
        } else {
          const clampZoomOut = (p: number, imgSize: number, vpSize: number) => {
            if (imgSize <= vpSize) {
              const maxP = vpSize / 3;
              return Math.min(maxP, Math.max(-maxP, p));
            }
            const maxP = imgSize / 2 - vpSize / 6;
            return Math.min(maxP, Math.max(-maxP, p));
          };
          nx = clampZoomOut(nx, newIW, vp.w);
          ny = clampZoomOut(ny, newIH, vp.h);
        }
      }

      setScale(newS);
      setPanX(nx);
      setPanY(ny);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [imgRef]);

  const applyPinchTransform = useCallback(
    (s: number, px: number, py: number) => {
      const container = imageContainerRef.current;
      if (!container) return;
      const inner = container.querySelector<HTMLElement>(":scope > div");
      if (!inner) return;
      inner.style.transition = "none";
      inner.style.transform = `translate(${px}px, ${py}px) scale(${s})`;
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const ptrs = pointersRef.current;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      if (ptrs.size === 2) {
        // Enter pinch mode — cancel any ongoing drag
        isDragging.current = false;
        const [a, b] = [...ptrs.values()];
        const container = imageContainerRef.current;
        const rect = container?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : 0;
        const cy = rect ? rect.top + rect.height / 2 : 0;
        pinchRef.current = {
          startDist: getPinchDist(a, b),
          startScale: scaleRef.current,
          startPanX: panXRef.current,
          startPanY: panYRef.current,
          midX: (a.x + b.x) / 2 - cx,
          midY: (a.y + b.y) / 2 - cy,
        };
        e.preventDefault();
        return;
      }

      // Single pointer — start drag (only when zoomed)
      if (ptrs.size === 1) {
        if (e.button !== 0 || !isZoomed) return;
        e.preventDefault();
        isDragging.current = true;
        setDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      }
    },
    [isZoomed, panX, panY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ptrs = pointersRef.current;
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // Pinch mode
      if (ptrs.size === 2 && pinchRef.current) {
        const [a, b] = [...ptrs.values()];
        const dist = getPinchDist(a, b);
        const pinch = pinchRef.current;
        const ratio = dist / pinch.startDist;
        const newS = Math.min(
          MAX_SCALE,
          Math.max(initialScaleRef.current, pinch.startScale * ratio),
        );

        const container = imageContainerRef.current;
        const rect = container?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : 0;
        const cy = rect ? rect.top + rect.height / 2 : 0;
        const newMidX = (a.x + b.x) / 2 - cx;
        const newMidY = (a.y + b.y) / 2 - cy;

        // Zoom relative to pinch midpoint + follow finger movement
        const scaleRatio = newS / pinch.startScale;
        const nx =
          pinch.startPanX +
          (pinch.midX - pinch.startPanX) * (1 - scaleRatio) +
          (newMidX - pinch.midX);
        const ny =
          pinch.startPanY +
          (pinch.midY - pinch.startPanY) * (1 - scaleRatio) +
          (newMidY - pinch.midY);

        scaleRef.current = newS;
        panXRef.current = nx;
        panYRef.current = ny;
        applyPinchTransform(newS, nx, ny);
        return;
      }

      // Drag mode
      if (!isDragging.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPanX(dragStart.current.panX + dx);
      setPanY(dragStart.current.panY + dy);
    },
    [applyPinchTransform],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ptrs = pointersRef.current;
    ptrs.delete(e.pointerId);

    if (pinchRef.current) {
      // Finalize pinch — commit refs to React state
      const finalScale = scaleRef.current;
      const finalPX = panXRef.current;
      const finalPY = panYRef.current;
      pinchRef.current = null;
      setScale(finalScale);
      setPanX(finalPX);
      setPanY(finalPY);
      setDragging(false);
      isDragging.current = false;
      return;
    }

    isDragging.current = false;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      setScale(initialScaleValue);
      setPanX(0);
      setPanY(0);
    } else {
      setScale(Math.min(MAX_SCALE, initialScaleValue * 2));
    }
  }, [isZoomed, initialScaleValue]);

  const resetZoom = useCallback(
    (newInitialScale?: number) => {
      setScale(newInitialScale ?? initialScaleValue);
      setPanX(0);
      setPanY(0);
    },
    [initialScaleValue],
  );

  return {
    scale,
    panX,
    panY,
    isZoomed,
    dragging,
    initialScaleValue,
    imageContainerRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleDoubleClick,
    resetZoom,
  };
}
