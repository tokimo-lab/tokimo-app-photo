import { useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { convertHeicToJpeg } from "../../utils/heic-decoder";
import { LivePhotoIcon } from "./LivePhotoIcon";
import { PhotoInfoPanel } from "./PhotoInfoPanel";
import {
  FaceHighlightOverlay,
  OcrBlockSelectLayer,
  OcrHighlightOverlay,
} from "./photo-overlays";
import { THUMB_WIDTH } from "./photo-utils";

const ANIM_DURATION = 300;
const ANIM_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

interface FlyRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function queryElementRect(selector: string): FlyRect | null {
  const el = document.querySelector(selector);
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

/** For images smaller than the available area, compute a default zoom (up to 2×)
 *  that fills the viewport without requiring drag/pan. */
function computeInitialScale(
  photoWidth: number,
  photoHeight: number,
  infoPanelVisible: boolean,
): number {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoW = infoPanelVisible ? 320 : 0;
  const pad = 48;
  const availW = Math.max(1, vw - infoW - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const fitScale = Math.min(availW / photoWidth, availH / photoHeight);
  if (fitScale <= 1) return 1;
  return Math.min(2, fitScale);
}

/** Compute where the lightbox image will be rendered (center of available area).
 *  Accounts for initialScale so the fly animation target matches the actual display. */
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

  const fitScale = Math.min(availW / photoWidth, availH / photoHeight);
  let w: number;
  let h: number;

  if (fitScale >= 1) {
    // Image is smaller than available area — visual size = natural × initialScale
    const s = Math.min(2, fitScale);
    w = photoWidth * s;
    h = photoHeight * s;
  } else {
    // Image is larger — constrain to available area (object-contain)
    const imgAspect = photoWidth / photoHeight;
    const areaAspect = availW / availH;
    if (imgAspect > areaAspect) {
      w = availW;
      h = w / imgAspect;
    } else {
      h = availH;
      w = h * imgAspect;
    }
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
  animSourceSelector,
}: {
  photo: PhotoOutput;
  allPhotos: PhotoOutput[];
  onClose: () => void;
  onNavigate: (p: PhotoOutput) => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  onNavigateToPerson?: (personId: string) => void;
  /** CSS selector for the animation source/target element.
   *  Defaults to `[data-photo-id="${photo.id}"]` (grid thumbnail). */
  animSourceSelector?: string;
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
  const [ocrSelectionRanges, setOcrSelectionRanges] = useState<
    Map<string, { start: number; end: number }>
  >(new Map());
  const imgRef = useRef<HTMLImageElement>(null);

  // ── Zoom & Pan state ──────────────────────────────────────────────────────
  // Compute the ideal initial scale for this photo (auto-zoom small images)
  const initialScaleValue = useMemo(() => {
    if (!photo.width || !photo.height) return 1;
    return computeInitialScale(photo.width, photo.height, showInfo);
  }, [photo.width, photo.height, showInfo]);

  const [scale, setScale] = useState(() => {
    if (!photo.width || !photo.height) return 1;
    return computeInitialScale(photo.width, photo.height, showInfo);
  });
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const isZoomed = scale > initialScaleValue + 0.01;
  // Refs mirror state so the native wheel listener (empty deps) reads fresh values
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const panXRef = useRef(panX);
  panXRef.current = panX;
  const panYRef = useRef(panY);
  panYRef.current = panY;
  const initialScaleRef = useRef(initialScaleValue);
  initialScaleRef.current = initialScaleValue;

  // ── Fly animation state ────────────────────────────────────────────────────
  const [animState, setAnimState] = useState<AnimState>(() => {
    if (!photo.sourceId || photo.width == null || photo.height == null)
      return "open";
    if (
      !queryElementRect(animSourceSelector ?? `[data-photo-id="${photo.id}"]`)
    )
      return "open";
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

  // ── Live Photo state ──
  const isLive = !!photo.liveVideoPath;
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const [showLiveVideo, setShowLiveVideo] = useState(false);

  // Thumbnails are always WebP (server-side conversion)
  const thumbSrc = photo.sourceId
    ? `/api/photos/${photo.id}/thumbnail?w=${THUMB_WIDTH}`
    : undefined;

  // Reset state when navigating to a different photo
  if (prevPhotoId.current !== photo.id) {
    prevPhotoId.current = photo.id;
    setFullLoaded(false);
    setFullDecoded(false);
    setLoadProgress(0);
    setScale(initialScaleValue);
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
    setShowLiveVideo(false);
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

    const thumbRect = queryElementRect(
      animSourceSelector ?? `[data-photo-id="${photo.id}"]`,
    );
    if (!thumbRect || photo.width == null || photo.height == null) {
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

    const thumbRect = queryElementRect(
      animSourceSelector ?? `[data-photo-id="${photo.id}"]`,
    );
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
  }, [
    animState,
    photo,
    showInfo,
    detail,
    thumbSrc,
    onClose,
    animSourceSelector,
  ]);

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
      setScale(initialScaleValue);
      setPanX(0);
      setPanY(0);
    } else {
      setScale(Math.min(MAX_SCALE, initialScaleValue * 2));
    }
  }, [isZoomed, initialScaleValue]);

  // Server serves raw image; browser decode test determines if fallback JPEG conversion is needed
  const fullSrc = photo.sourceId ? `/api/photos/${photo.id}/image` : undefined;

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

        let blob: Blob;

        if (!res.body) {
          blob = await res.blob();
          if (abort.signal.aborted) return;
        } else {
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

          blob = new Blob(chunks, {
            type: res.headers.get("Content-Type") || "image/jpeg",
          });
        }

        const url = URL.createObjectURL(blob);

        // Try native browser decode; fall back to WASM HEIC decoder if unsupported
        const testImg = new Image();
        testImg.src = url;
        try {
          await testImg.decode();
          setFullBlobUrl(url);
          setLoadProgress(1);
          setFullLoaded(true);
        } catch {
          URL.revokeObjectURL(url);
          // Decode HEIC via WASM (libheif)
          try {
            const jpegBlob = await convertHeicToJpeg(blob);
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
            setLoadProgress(1);
            setFullLoaded(true);
          } catch {
            // Last resort: server-side JPEG conversion
            const jpegRes = await fetch(`${fullSrc}?format=jpeg`, {
              signal: abort.signal,
            });
            const jpegBlob = await jpegRes.blob();
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
            setLoadProgress(1);
            setFullLoaded(true);
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[PhotoLightbox] Failed to load image:", err);
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

  // Compute the CSS rendered size of the img element (before transform scale).
  // For small images, this is their natural size (scale handles zoom).
  // For large images, this is the object-contain fit size.
  const thumbDisplaySize = useMemo(() => {
    if (!photo.width || !photo.height) return undefined;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const infoW = showInfo ? 320 : 0;
    const pad = 48;
    const availW = Math.max(1, vw - infoW - pad * 2);
    const availH = Math.max(1, vh - pad * 2);
    const fitScale = Math.min(availW / photo.width, availH / photo.height);
    if (fitScale >= 1) {
      // Small image: render at natural size; transform scale handles zoom
      return { width: photo.width, height: photo.height };
    }
    // Large image: constrain to available area
    const imgAspect = photo.width / photo.height;
    if (imgAspect > availW / availH) {
      return { width: availW, height: availW / imgAspect };
    }
    return { width: availH * imgAspect, height: availH };
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
            {/* Live Photo indicator + toggle */}
            {isLive && (
              <button
                type="button"
                className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-white transition-colors ${
                  showLiveVideo
                    ? "bg-white/30 ring-1 ring-white/50"
                    : "bg-black/50 hover:bg-black/70"
                }`}
                onClick={() => {
                  setShowLiveVideo((v) => {
                    const next = !v;
                    if (next) {
                      requestAnimationFrame(() =>
                        liveVideoRef.current?.play().catch(() => {}),
                      );
                    } else if (liveVideoRef.current) {
                      liveVideoRef.current.pause();
                      liveVideoRef.current.currentTime = 0;
                    }
                    return next;
                  });
                }}
                title="Live Photo"
              >
                <LivePhotoIcon size={16} />
                <span className="text-xs font-medium">LIVE</span>
              </button>
            )}
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
                {ocrResults &&
                  ocrResults.length > 0 &&
                  detail?.width &&
                  detail?.height && (
                    <OcrBlockSelectLayer
                      ocrResults={ocrResults}
                      photoWidth={detail.width}
                      photoHeight={detail.height}
                      imgRef={imgRef}
                      isZoomed={isZoomed}
                      onSelectionRanges={setOcrSelectionRanges}
                    />
                  )}
                {/* Live Photo video overlay */}
                {isLive && showLiveVideo && (
                  <video
                    ref={liveVideoRef}
                    src={`/api/photos/${photo.id}/live-video`}
                    className="absolute inset-0 h-full w-full object-contain"
                    muted
                    playsInline
                    loop
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
          <div className="flex w-80 shrink-0 flex-col border-l border-[var(--border-base)] bg-[var(--sidebar-bg)] text-sm text-white backdrop-blur">
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
                    ocrSelectionRanges={ocrSelectionRanges}
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
