import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SCALE = 20;

interface ViewerZoomPanOptions {
  imgRef: React.RefObject<HTMLImageElement | null>;
}

function getPinchDist(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function useViewerZoomPan({ imgRef }: ViewerZoomPanOptions) {
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const isZoomed = scale > 1.01;

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;

  // Pinch-to-zoom state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    startDist: number;
    startScale: number;
    startPanX: number;
    startPanY: number;
    startMidX: number;
    startMidY: number;
  } | null>(null);

  // Pan boundary clamping — snaps back after drag ends or zoom changes
  useEffect(() => {
    if (dragging) return;
    const img = imgRef.current;
    const container = containerRef.current;
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
    const container = containerRef.current;
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

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const img = imgRef.current;
      if (!img) return;

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - (rect.left + rect.width / 2);
      const cursorY = e.clientY - (rect.top + rect.height / 2);

      const oldS = scaleRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const newS = Math.min(MAX_SCALE, Math.max(1, oldS * factor));
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
          const clampAxis = (p: number, imgSize: number, vpSize: number) => {
            if (imgSize <= vpSize) {
              const maxP = vpSize / 3;
              return Math.min(maxP, Math.max(-maxP, p));
            }
            const maxP = imgSize / 2 - vpSize / 6;
            return Math.min(maxP, Math.max(-maxP, p));
          };
          nx = clampAxis(nx, newIW, vp.w);
          ny = clampAxis(ny, newIH, vp.h);
        }
      }

      setScale(newS);
      setPanX(nx);
      setPanY(ny);
    };
    container.addEventListener("wheel", handler, { passive: false });
    return () => container.removeEventListener("wheel", handler);
  }, [imgRef]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      if (pointersRef.current.size === 2) {
        // Start pinch — cancel any ongoing drag
        isDragging.current = false;
        setDragging(true); // suppress boundary clamping during pinch

        const [a, b] = [...pointersRef.current.values()];
        const dist = getPinchDist(a, b);
        const container = containerRef.current;
        const rect = container?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : 0;
        const cy = rect ? rect.top + rect.height / 2 : 0;
        pinchRef.current = {
          startDist: dist,
          startScale: scaleRef.current,
          startPanX: panXRef.current,
          startPanY: panYRef.current,
          startMidX: (a.x + b.x) / 2 - cx,
          startMidY: (a.y + b.y) / 2 - cy,
        };
        return;
      }

      // Single pointer drag (only when zoomed)
      if (e.button !== 0 || !isZoomed) return;
      e.preventDefault();
      isDragging.current = true;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    },
    [isZoomed, panX, panY],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });

    // Pinch mode
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = getPinchDist(a, b);
      const pinch = pinchRef.current;
      const ratio = dist / pinch.startDist;
      const newScale = Math.min(
        MAX_SCALE,
        Math.max(1, pinch.startScale * ratio),
      );

      // Zoom relative to pinch midpoint
      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : 0;
      const cy = rect ? rect.top + rect.height / 2 : 0;
      const midX = (a.x + b.x) / 2 - cx;
      const midY = (a.y + b.y) / 2 - cy;

      const scaleChange = newScale / pinch.startScale;
      const nx =
        midX -
        (pinch.startMidX - pinch.startPanX) * scaleChange +
        (midX - pinch.startMidX);
      const ny =
        midY -
        (pinch.startMidY - pinch.startPanY) * scaleChange +
        (midY - pinch.startMidY);

      // Direct DOM update for performance
      scaleRef.current = newScale;
      panXRef.current = nx;
      panYRef.current = ny;

      const wrapper = container?.querySelector(
        ".absolute.inset-0 > div",
      ) as HTMLElement | null;
      if (wrapper) {
        wrapper.style.transition = "none";
        wrapper.style.transform = `translate(${nx}px, ${ny}px) scale(${newScale})`;
      }
      return;
    }

    // Single pointer drag
    if (!isDragging.current) return;
    setPanX(dragStart.current.panX + e.clientX - dragStart.current.x);
    setPanY(dragStart.current.panY + e.clientY - dragStart.current.y);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);

    // Finalize pinch
    if (pinchRef.current) {
      const finalScale = scaleRef.current;
      const finalPanX = panXRef.current;
      const finalPanY = panYRef.current;
      pinchRef.current = null;
      setScale(finalScale);
      setPanX(finalPanX);
      setPanY(finalPanY);
      if (pointersRef.current.size === 0) {
        setDragging(false);
      }
      return;
    }

    isDragging.current = false;
    setDragging(false);
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      setScale(1);
      setPanX(0);
      setPanY(0);
    } else {
      setScale(Math.min(MAX_SCALE, 2));
    }
  }, [isZoomed]);

  return {
    scale,
    setScale,
    panX,
    panY,
    isZoomed,
    dragging,
    containerRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleDoubleClick,
    resetZoom,
    MAX_SCALE,
  };
}
