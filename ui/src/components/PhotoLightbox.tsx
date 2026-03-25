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
    { enabled: showInfo },
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

  // Use native wheel listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const container = imageContainerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);

      setScale((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
        const ratio = 1 - next / prev;
        setPanX((px) => px + (cx - px) * ratio);
        setPanY((py) => py + (cy - py) * ratio);
        return next;
      });
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
                  transition: dragging ? "none" : "transform 0.15s ease-out",
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
