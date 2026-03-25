import { useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  PhotoFaceOutput,
  PhotoOcrResultItem,
  PhotoOutput,
} from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { PhotoInfoPanel } from "./PhotoInfoPanel";
import { THUMB_WIDTH } from "./photo-utils";

const ANIM_DURATION = 300;
const ANIM_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

interface FlyRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function queryThumbnailRect(photoId: string): FlyRect | null {
  const el = document.querySelector(`[data-photo-id="${photoId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  if (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  )
    return null;
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

/** Compute where the lightbox image will be rendered (center of available area). */
function computeCenterRect(
  photoWidth: number,
  photoHeight: number,
  infoPanelVisible: boolean,
): FlyRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoW = infoPanelVisible ? 320 : 0;
  const pad = 48; // p-12
  const availW = Math.max(1, vw - infoW - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const imgAspect = photoWidth / photoHeight;
  const areaAspect = availW / availH;
  let w: number;
  let h: number;
  if (imgAspect > areaAspect) {
    w = availW;
    h = w / imgAspect;
  } else {
    h = availH;
    w = h * imgAspect;
  }
  return {
    top: pad + (availH - h) / 2,
    left: pad + (availW - w) / 2,
    width: w,
    height: h,
  };
}

type AnimState = "entering" | "open" | "exiting";

export function PhotoLightbox({
  photo,
  allPhotos,
  onClose,
  onNavigate,
  onToggleFavorite,
  onNavigateToPerson,
}: {
  photo: PhotoOutput;
  allPhotos: PhotoOutput[];
  onClose: () => void;
  onNavigate: (p: PhotoOutput) => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  onNavigateToPerson?: (personId: string) => void;
}) {
  const idx = allPhotos.findIndex((p) => p.id === photo.id);
  const hasPrev = idx > 0;
  const hasNext = idx < allPhotos.length - 1;
  const [showInfo, setShowInfo] = useState(() => {
    try {
      return localStorage.getItem("photo-lightbox-info") === "1";
    } catch {
      return false;
    }
  });
  const toggleInfo = useCallback(() => {
    setShowInfo((v) => {
      const next = !v;
      try {
        localStorage.setItem("photo-lightbox-info", next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const [hoveredOcrId, setHoveredOcrId] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // ── Zoom & Pan state ──────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const isZoomed = scale > 1.01;
  // Refs mirror state so the native wheel listener (empty deps) reads fresh values
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;

  // ── Fly animation state ────────────────────────────────────────────────────
  const [animState, setAnimState] = useState<AnimState>(() => {
    if (!photo.sourceId || photo.width == null || photo.height == null)
      return "open";
    if (!queryThumbnailRect(photo.id)) return "open";
    return "entering";
  });
  const [flyRect, setFlyRect] = useState<FlyRect | null>(null);
  const [flyTransition, setFlyTransition] = useState(false);

  // ── Progressive image loading: thumbnail first, then full-res ─────────────
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [fullDecoded, setFullDecoded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 0..1
  const prevPhotoId = useRef(photo.id);
  const abortRef = useRef<AbortController | null>(null);

  const thumbSrc = photo.sourceId
    ? `/api/photos/${photo.id}/thumbnail?w=${THUMB_WIDTH}`
    : undefined;

  // Reset state when navigating to a different photo
  if (prevPhotoId.current !== photo.id) {
    prevPhotoId.current = photo.id;
    setFullLoaded(false);
    setFullDecoded(false);
    setLoadProgress(0);
    setScale(1);
    setPanX(0);
    setPanY(0);
    if (fullBlobUrl) {
      URL.revokeObjectURL(fullBlobUrl);
      setFullBlobUrl(null);
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  const detailQuery = api.app.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const detail = detailQuery.data;

  const facesQuery = api.photoSettings.getPhotoFaces.useQuery(
    { photoId: photo.id },
    { enabled: showInfo },
  );
  const faces = facesQuery.data;

  const ocrQuery = api.photoSettings.getPhotoOcrResults.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const ocrResults = ocrQuery.data;

  // ── Edit mode state ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDate, setEditDate] = useState("");
  const queryClient = useQueryClient();

  const updateMutation = api.app.updatePhoto.useMutation();

  const startEdit = useCallback(() => {
    setEditTitle(detail?.title || photo.title || "");
    setEditDesc(detail?.description || "");
    setEditDate(detail?.takenAt ? detail.takenAt.slice(0, 16) : "");
    setEditing(true);
  }, [detail, photo]);

  const saveEdit = useCallback(() => {
    updateMutation.mutate(
      {
        photoId: photo.id,
        title: editTitle || undefined,
        description: editDesc || undefined,
        takenAt: editDate ? new Date(editDate).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setEditing(false);
          queryClient.invalidateQueries({
            queryKey: ["/api/photos/{id}"],
          });
        },
      },
    );
  }, [photo.id, editTitle, editDesc, editDate, updateMutation, queryClient]);

  // ── Enter animation (mount-only) ─────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
  useEffect(() => {
    if (animState !== "entering") return;

    const thumbRect = queryThumbnailRect(photo.id);
    if (!thumbRect || photo.width == null || photo.height == null) {
      setAnimState("open");
      return;
    }

    // Use showInfo (from localStorage) to compute correct target position
    const target = computeCenterRect(photo.width, photo.height, showInfo);
    setFlyRect(thumbRect);
    setFlyTransition(false);

    // Double rAF ensures the initial (thumbnail) position is painted first
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyRect(target);
        setFlyTransition(true);
      });
    });

    const timer = setTimeout(() => {
      setAnimState("open");
      setFlyRect(null);
      setFlyTransition(false);
    }, ANIM_DURATION + 50);

    return () => clearTimeout(timer);
  }, []);

  // ── Close with animation ───────────────────────────────────────────────────
  const handleAnimatedClose = useCallback(() => {
    if (animState === "exiting") return;

    const thumbRect = queryThumbnailRect(photo.id);
    const infoVisible = showInfo && detail != null;

    if (thumbRect && photo.width != null && photo.height != null && thumbSrc) {
      const current = computeCenterRect(photo.width, photo.height, infoVisible);
      setAnimState("exiting");
      setFlyRect(current);
      setFlyTransition(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlyRect(thumbRect);
          setFlyTransition(true);
        });
      });

      setTimeout(() => onClose(), ANIM_DURATION + 50);
    } else {
      // No thumbnail visible — fade out
      setAnimState("exiting");
      setTimeout(() => onClose(), ANIM_DURATION + 50);
    }
  }, [animState, photo, showInfo, detail, thumbSrc, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleAnimatedClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(allPhotos[idx - 1]);
      if (e.key === "ArrowRight" && hasNext) onNavigate(allPhotos[idx + 1]);
      if (e.key === "i") toggleInfo();
      if (e.key === "f" && onToggleFavorite) onToggleFavorite(photo);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    idx,
    hasPrev,
    hasNext,
    allPhotos,
    handleAnimatedClose,
    onNavigate,
    photo,
    onToggleFavorite,
    toggleInfo,
  ]);

  // ── Zoom & Pan handlers ─────────────────────────────────────────────────────
  const MIN_SCALE = 1;
  const MAX_SCALE = 20;

  // Clamp pan: if image overflows in ANY direction, allow panning both axes (black border ≤ 1/3)
  // Snap-back effect: after drag ends or zoom changes, clamp pan with transition
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

    // If image fits entirely in both axes → center
    const overflows = iw > cw || ih > ch;
    if (!overflows) {
      if (panX !== 0 || panY !== 0) {
        setPanX(0);
        setPanY(0);
      }
      return;
    }

    // At least one axis overflows: clamp each axis by its own 1/3 rule
    const clamp = (p: number, img: number, vp: number) => {
      if (img <= vp) {
        // This axis fits, but allow up to 1/3 viewport of pan
        const maxP = vp / 3;
        return Math.min(maxP, Math.max(-maxP, p));
      }
      const maxP = img / 2 - vp / 6;
      return Math.min(maxP, Math.max(-maxP, p));
    };

    const cx = clamp(panX, iw, cw);
    const cy = clamp(panY, ih, ch);

    if (cx !== panX || cy !== panY) {
      setPanX(cx);
      setPanY(cy);
    }
  }, [scale, panX, panY, dragging]);

  // Use native wheel listener with { passive: false } to allow preventDefault
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

    // Compute the gap (black border) on each side for one axis.
    // Positive gap = visible black border.
    const gaps = (pan: number, imgHalf: number, vpHalf: number) => ({
      lo: pan - imgHalf + vpHalf, // left / top gap
      hi: vpHalf - pan - imgHalf, // right / bottom gap
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
      const newS = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldS * factor));
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
        // ── Zoom in: black borders must not grow ──
        const oldGX = gaps(oldPX, oldIW / 2, vp.w / 2);
        const oldGY = gaps(oldPY, oldIH / 2, vp.h / 2);

        // Clamp X: if a positive gap would increase, pin that edge
        const newGXlo = nx - newIW / 2 + vp.w / 2;
        if (oldGX.lo > 0 && newGXlo > oldGX.lo) {
          nx -= newGXlo - oldGX.lo;
        }
        const newGXhi = vp.w / 2 - nx - newIW / 2;
        if (oldGX.hi > 0 && newGXhi > oldGX.hi) {
          nx += newGXhi - oldGX.hi;
        }

        // Clamp Y
        const newGYlo = ny - newIH / 2 + vp.h / 2;
        if (oldGY.lo > 0 && newGYlo > oldGY.lo) {
          ny -= newGYlo - oldGY.lo;
        }
        const newGYhi = vp.h / 2 - ny - newIH / 2;
        if (oldGY.hi > 0 && newGYhi > oldGY.hi) {
          ny += newGYhi - oldGY.hi;
        }
      } else {
        // ── Zoom out: apply 1/3 boundary clamp immediately ──
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
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !isZoomed) return;
      isDragging.current = true;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isZoomed, panX, panY],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPanX(dragStart.current.panX + dx);
    setPanY(dragStart.current.panY + dy);
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      setScale(1);
      setPanX(0);
      setPanY(0);
    } else {
      setScale(3);
    }
  }, [isZoomed]);

  const isHeic =
    photo.mimeType === "image/heif" ||
    photo.mimeType === "image/heic" ||
    /\.heic$/i.test(photo.filename) ||
    /\.heif$/i.test(photo.filename);

  const fullSrc = photo.sourceId
    ? isHeic
      ? `/api/photos/${photo.id}/thumbnail?w=1920`
      : `/api/photos/${photo.id}/image`
    : undefined;

  // Don't start loading full-res until enter animation finishes
  const shouldLoadFull = animState !== "entering";

  // ── Fetch full-res image with real progress tracking ────────────────────────
  useEffect(() => {
    if (!shouldLoadFull || fullLoaded || !fullSrc) return;

    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(fullSrc, { signal: abort.signal });
        const contentLength = res.headers.get("Content-Length");
        const total = contentLength ? Number.parseInt(contentLength, 10) : 0;

        if (!res.body) {
          const blob = await res.blob();
          if (abort.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          setFullBlobUrl(url);
          setLoadProgress(1);
          setFullLoaded(true);
          return;
        }

        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total > 0) {
            setLoadProgress(Math.min(received / total, 1));
          } else {
            setLoadProgress(Math.min(received / (received + 200_000), 0.95));
          }
        }

        if (abort.signal.aborted) return;

        const blob = new Blob(chunks, {
          type: res.headers.get("Content-Type") || "image/jpeg",
        });
        const url = URL.createObjectURL(blob);
        setFullBlobUrl(url);
        setLoadProgress(1);
        setFullLoaded(true);
      } catch {
        if (!abort.signal.aborted) {
          setLoadProgress(0);
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [shouldLoadFull, fullLoaded, fullSrc]);

  // Clean up blob URL on unmount
  useEffect(() => {
    const url = fullBlobUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [fullBlobUrl]);

  const isFav = detail?.isFavorite ?? photo.isFavorite;

  // ── Animation-derived values ───────────────────────────────────────────────
  const showFlyImage = animState !== "open" && flyRect != null;
  const contentVisible = animState === "open";
  const isExitFade = animState === "exiting" && flyRect == null;

  // Compute the display size the image should occupy so the thumbnail
  // scales UP to match the full-res layout (prevents tiny-thumbnail flash).
  const thumbDisplaySize = useMemo(() => {
    if (!photo.width || !photo.height) return undefined;
    const rect = computeCenterRect(photo.width, photo.height, showInfo);
    return { width: rect.width, height: rect.height };
  }, [photo.width, photo.height, showInfo]);

  let backdropOpacity: number;
  if (animState === "open") {
    backdropOpacity = 1;
  } else if (animState === "entering") {
    backdropOpacity = flyTransition ? 1 : 0;
  } else {
    // exiting: keep opaque until fly transition starts, then fade out
    backdropOpacity = flyRect != null && !flyTransition ? 1 : 0;
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black"
        style={{
          opacity: backdropOpacity,
          transition: `opacity ${ANIM_DURATION}ms ${ANIM_EASING}`,
        }}
      />

      {/* Flying image overlay (visible during enter/exit animation) */}
      {showFlyImage && flyRect && (
        <div
          className="pointer-events-none fixed overflow-hidden"
          style={{
            zIndex: 20,
            top: flyRect.top,
            left: flyRect.left,
            width: flyRect.width,
            height: flyRect.height,
            borderRadius: flyTransition
              ? animState === "entering"
                ? 0
                : 6
              : animState === "entering"
                ? 6
                : 0,
            transition: flyTransition
              ? `top ${ANIM_DURATION}ms ${ANIM_EASING}, left ${ANIM_DURATION}ms ${ANIM_EASING}, width ${ANIM_DURATION}ms ${ANIM_EASING}, height ${ANIM_DURATION}ms ${ANIM_EASING}, border-radius ${ANIM_DURATION}ms ${ANIM_EASING}`
              : "none",
            willChange: "top, left, width, height",
          }}
        >
          <img
            src={thumbSrc}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      )}

      {/* Main content */}
      <div
        className="relative z-10 flex h-full"
        style={{
          opacity: contentVisible ? 1 : 0,
          pointerEvents: contentVisible ? "auto" : "none",
          transition: isExitFade
            ? `opacity ${ANIM_DURATION}ms ${ANIM_EASING}`
            : "none",
        }}
      >
        {/* ── Photo area (flex-1, takes remaining space) ── */}
        <div className="relative flex flex-1 flex-col">
          {/* Top toolbar */}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            {onToggleFavorite && (
              <button
                type="button"
                className="cursor-pointer rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
                onClick={() => onToggleFavorite(photo)}
                title="收藏 (F)"
              >
                <Heart
                  className={`h-5 w-5 ${
                    isFav ? "fill-red-500 text-red-500" : "text-white"
                  }`}
                />
              </button>
            )}
            <button
              type="button"
              className="cursor-pointer rounded-full bg-black/50 px-3 py-2 text-xs text-white transition-colors hover:bg-black/70"
              onClick={toggleInfo}
            >
              ℹ️ 详情
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              onClick={handleAnimatedClose}
            >
              ✕
            </button>
          </div>

          {/* Previous */}
          {hasPrev && (
            <button
              type="button"
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
              onClick={() => onNavigate(allPhotos[idx - 1])}
            >
              ‹
            </button>
          )}

          {/* Next */}
          {hasNext && (
            <button
              type="button"
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
              onClick={() => onNavigate(allPhotos[idx + 1])}
            >
              ›
            </button>
          )}

          {/* Image */}
          <div
            ref={imageContainerRef}
            role="application"
            className="flex flex-1 items-center justify-center overflow-hidden p-12"
            style={{
              cursor: dragging ? "grabbing" : isZoomed ? "grab" : "default",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            {thumbSrc || fullSrc ? (
              <div
                className="relative inline-block max-h-full max-w-full"
                style={{
                  transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                  transformOrigin: "center center",
                  transition: dragging
                    ? "none"
                    : "transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)",
                }}
              >
                {/* Thumbnail layer: stays visible until full-res is decoded */}
                {thumbSrc && !fullDecoded && (
                  <img
                    ref={fullDecoded ? undefined : imgRef}
                    src={thumbSrc}
                    alt={photo.title || photo.filename}
                    className="max-h-[calc(100vh-6rem)] max-w-full select-none object-contain"
                    style={thumbDisplaySize}
                    draggable={false}
                  />
                )}
                {/* Full-res layer: starts rendering once blob URL is ready */}
                {fullBlobUrl && (
                  <img
                    ref={fullDecoded ? imgRef : undefined}
                    src={fullBlobUrl}
                    alt={photo.title || photo.filename}
                    className={`max-h-[calc(100vh-6rem)] max-w-full select-none object-contain ${!fullDecoded ? "absolute inset-0 opacity-0" : ""}`}
                    draggable={false}
                    onLoad={() => setFullDecoded(true)}
                  />
                )}
                {/* Real download progress bar */}
                {shouldLoadFull && !fullLoaded && fullSrc && (
                  <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
                    <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-white/30"
                        style={{
                          width: `${loadProgress * 100}%`,
                          transition: "width 150ms ease-out",
                        }}
                      />
                    </div>
                  </div>
                )}
                {hoveredFaceId != null &&
                  faces &&
                  detail?.width &&
                  detail?.height && (
                    <FaceHighlightOverlay
                      faces={faces}
                      hoveredFaceId={hoveredFaceId}
                      photoWidth={detail.width}
                      photoHeight={detail.height}
                      imgRef={imgRef}
                    />
                  )}
                {hoveredOcrId != null &&
                  ocrResults &&
                  detail?.width &&
                  detail?.height && (
                    <OcrHighlightOverlay
                      ocrResults={ocrResults}
                      hoveredOcrId={hoveredOcrId}
                      photoWidth={detail.width}
                      photoHeight={detail.height}
                      imgRef={imgRef}
                    />
                  )}
                {/* Live Text: block-based selectable OCR overlay (iOS-style) */}
                {!isZoomed &&
                  ocrResults &&
                  ocrResults.length > 0 &&
                  detail?.width &&
                  detail?.height && (
                    <OcrBlockSelectLayer
                      ocrResults={ocrResults}
                      photoWidth={detail.width}
                      photoHeight={detail.height}
                      imgRef={imgRef}
                    />
                  )}
              </div>
            ) : (
              <div className="text-neutral-400">无法加载图片</div>
            )}
          </div>

          {/* Bottom bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70">
            {idx + 1} / {allPhotos.length} — {photo.filename}
            {isZoomed && (
              <span className="ml-2 text-white/50">
                {Math.round(scale * 100)}%
              </span>
            )}
          </div>
        </div>

        {/* ── Info panel (fixed-width side panel) ── */}
        {showInfo && (
          <div className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-neutral-900/95 text-sm text-white backdrop-blur">
            {detail ? (
              <>
                {/* Sticky header */}
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                  <span className="text-sm font-semibold text-neutral-300">
                    照片信息
                  </span>
                  {!editing ? (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="cursor-pointer rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-white/10"
                    >
                      编辑
                    </button>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={saveEdit}
                        className="cursor-pointer rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-500"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="cursor-pointer rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-white/10"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <PhotoInfoPanel
                    detail={detail}
                    fallbackTitle={photo.title || photo.filename}
                    hoveredFaceId={hoveredFaceId}
                    onHoverFace={setHoveredFaceId}
                    hoveredOcrId={hoveredOcrId}
                    onHoverOcr={setHoveredOcrId}
                    onNavigateToPerson={onNavigateToPerson}
                    onRefreshComplete={() => {
                      queryClient.invalidateQueries({
                        queryKey: ["/api/photos/{id}"],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["/api/photos/{id}/faces"],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["/api/photos/{id}/ocr-results"],
                      });
                    }}
                    editForm={
                      editing ? (
                        <div className="mb-4 space-y-2">
                          <label className="block">
                            <span className="mb-1 block text-xs text-neutral-500">
                              标题
                            </span>
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                              placeholder="照片标题"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-neutral-500">
                              描述
                            </span>
                            <textarea
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                              rows={2}
                              placeholder="照片描述"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs text-neutral-500">
                              拍摄时间
                            </span>
                            <input
                              type="datetime-local"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                            />
                          </label>
                        </div>
                      ) : null
                    }
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                  <span className="text-sm font-semibold text-neutral-300">
                    照片信息
                  </span>
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <div className="text-xs text-neutral-500">加载中…</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Overlay that draws a highlight box around the hovered face on the photo */
function FaceHighlightOverlay({
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
  const [imgRect, setImgRect] = useState<{
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const measure = () => {
      const rect = img.getBoundingClientRect();
      const parent = img.parentElement?.getBoundingClientRect();
      if (!parent) return;
      // The image uses object-contain, so rendered size may differ from element size
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

/** Overlay that highlights OCR bounding box regions on the image. */
function OcrHighlightOverlay({
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
  const [imgRect, setImgRect] = useState<{
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const measure = () => {
      const rect = img.getBoundingClientRect();
      const parent = img.parentElement?.getBoundingClientRect();
      if (!parent) return;
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

// ---- Character-level OCR selection helpers ----

let _ocrMeasureCtx: CanvasRenderingContext2D | null = null;
function getOcrMeasureCtx(): CanvasRenderingContext2D {
  if (!_ocrMeasureCtx) {
    _ocrMeasureCtx = document.createElement("canvas").getContext("2d")!;
  }
  return _ocrMeasureCtx;
}

interface OcrCharPos {
  /** Offset from block left edge in display pixels */
  x: number;
  /** Display width of this character */
  w: number;
}

interface OcrBlock {
  id: string;
  text: string;
  /** Array.from(text) — handles surrogate pairs */
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

/** Estimate per-character positions within a block using canvas measureText */
function measureOcrCharPositions(
  text: string,
  blockW: number,
  blockH: number,
): { chars: OcrCharPos[]; textChars: string[] } {
  const textChars = Array.from(text);
  if (textChars.length === 0) return { chars: [], textChars };
  const ctx = getOcrMeasureCtx();
  ctx.font = `${Math.round(blockH)}px sans-serif`;
  let totalW = 0;
  const widths: number[] = [];
  for (const ch of textChars) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    totalW += w;
  }
  const scale = totalW > 0 ? blockW / totalW : 1;
  const chars: OcrCharPos[] = [];
  let cumX = 0;
  for (const w of widths) {
    const sw = w * scale;
    chars.push({ x: cumX, w: sw });
    cumX += sw;
  }
  return { chars, textChars };
}

/** Find the character index at a local X position within a block */
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

/** Find the block+char position nearest to a layer-local coordinate.
 *  When anchorBlockIdx is provided, strongly prefer blocks in the same
 *  visual column (X-overlap with anchor) to prevent cross-column jumps. */
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
  // Nearest block — penalise blocks outside the anchor's paragraph
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

/** Check whether an intermediate block belongs to the same paragraph as the
 *  start/end blocks.  When paragraphId > 0 (PP-OCRv5 with clustering), uses
 *  exact paragraph match.  Falls back to spatial column heuristic for legacy
 *  OCR results (paragraphId === 0). */
function isBlockInSelectionParagraph(
  block: OcrBlock,
  startBlock: OcrBlock,
  endBlock: OcrBlock,
): boolean {
  // PP-OCRv5 paragraph grouping — exact match
  if (startBlock.paragraphId > 0 && endBlock.paragraphId > 0) {
    return block.paragraphId === startBlock.paragraphId;
  }
  // Fallback: spatial column heuristic (for legacy v4 results)
  const xMin = Math.min(startBlock.x, endBlock.x);
  const xMax = Math.max(startBlock.x + startBlock.w, endBlock.x + endBlock.w);
  const pad = 50;
  return block.x + block.w > xMin - pad && block.x < xMax + pad;
}

/** Extract selected text for a character-level range (column-aware) */
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
  const startB = blocks[sBlock];
  const endB = blocks[eBlock];
  const parts: string[] = [];
  parts.push(startB.textChars.slice(sChar).join(""));
  for (let i = sBlock + 1; i < eBlock; i++) {
    if (isBlockInSelectionParagraph(blocks[i], startB, endB)) {
      parts.push(blocks[i].text);
    }
  }
  parts.push(endB.textChars.slice(0, eChar).join(""));
  return parts.join("\n");
}

/** Compute per-character highlight rectangles (column-aware) */
function computeOcrCharHighlights(
  blocks: OcrBlock[],
  anchor: OcrTextAnchor,
  focus: OcrTextAnchor,
): { x: number; y: number; w: number; h: number; key: string }[] {
  const { sBlock, sChar, eBlock, eChar } = normalizeOcrAnchors(anchor, focus);
  if (sBlock === eBlock && sChar === eChar) return [];
  const startB = blocks[sBlock];
  const endB = blocks[eBlock];
  const out: { x: number; y: number; w: number; h: number; key: string }[] = [];
  for (let i = sBlock; i <= eBlock; i++) {
    const b = blocks[i];
    if (b.chars.length === 0) continue;
    // Skip intermediate blocks outside the selection column
    if (
      i !== sBlock &&
      i !== eBlock &&
      !isBlockInSelectionParagraph(b, startB, endB)
    )
      continue;
    const from = i === sBlock ? sChar : 0;
    const to = i === eBlock ? eChar : b.textChars.length;
    if (from >= to) continue;
    const x0 = from < b.chars.length ? b.chars[from].x : b.w;
    const x1 = to >= b.chars.length ? b.w : b.chars[to].x;
    // Extend highlight vertically to match visual text line height
    // (OCR bounding boxes are tightly cropped around strokes)
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

/**
 * iOS Live Text style character-level selection overlay.
 * Estimates per-character positions via canvas measureText and supports
 * precise drag selection across OCR blocks. Double-click selects a whole
 * block, right-click shows copy menu.
 */
function OcrBlockSelectLayer({
  ocrResults,
  photoWidth,
  photoHeight,
  imgRef,
}: {
  ocrResults: PhotoOcrResultItem[];
  photoWidth: number;
  photoHeight: number;
  imgRef: React.RefObject<HTMLImageElement | null>;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [imgRect, setImgRect] = useState<{
    w: number;
    h: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [selection, setSelection] = useState<{
    anchor: OcrTextAnchor;
    focus: OcrTextAnchor;
  } | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Measure rendered image rect
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

  // Build blocks with per-character positions
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

  // Keyboard: Ctrl+C / Escape
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

  // Close context menu on outside click
  useEffect(() => {
    if (!menuPos) return;
    const onClick = () => setMenuPos(null);
    window.addEventListener("pointerdown", onClick);
    return () => window.removeEventListener("pointerdown", onClick);
  }, [menuPos]);

  if (!imgRect) return null;

  // --- Pure helpers + event handlers (no hooks below) ---

  const getLayerCoords = (e: React.MouseEvent) => {
    const layer = layerRef.current;
    if (!layer) return { x: 0, y: 0 };
    const rect = layer.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
    } else {
      // Started in empty space — clear selection but still track drag
      setSelection(null);
    }
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const { x, y } = getLayerCoords(e);
    const sel = selectionRef.current;
    if (!sel) {
      // Started from empty space — begin selection when cursor enters a block
      const idx = hitBlockIdx(x, y);
      if (idx >= 0) {
        const charIdx = ocrCharIdxAtX(blocks[idx].chars, x - blocks[idx].x);
        const anchor: OcrTextAnchor = { blockIdx: idx, charIdx };
        setSelection({ anchor, focus: anchor });
      }
    } else {
      // Extend existing selection with column bias
      const pos = ocrPositionAtPoint(blocks, x, y, sel.anchor.blockIdx);
      if (pos) {
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
    // Select entire block under cursor
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
          cursor: "text",
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
