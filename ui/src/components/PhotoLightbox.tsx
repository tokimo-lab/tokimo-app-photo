import { Heart } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { thumbUrl } from "@/lib/thumb";
import { LivePhotoIcon } from "./LivePhotoIcon";
import {
  ANIM_DURATION,
  ANIM_EASING,
  computeThumbDisplaySize,
  FADE_IN_EASING,
  FADE_OUT_EASING,
} from "./lightbox-utils";
import { PhotoInfoSidebar } from "./PhotoInfoSidebar";
import {
  FaceHighlightOverlay,
  OcrBlockSelectLayer,
  OcrHighlightOverlay,
} from "./photo-overlays";
import {
  getDisplayDimensions,
  photoImageUrl,
  photoLiveVideoUrl,
  THUMB_WIDTH,
} from "./photo-utils";
import { useLightboxFly } from "./use-lightbox-fly";
import { useLightboxImage } from "./use-lightbox-image";
import { useLightboxZoomPan } from "./use-lightbox-zoom-pan";

const preventDrag = (e: React.SyntheticEvent) => e.preventDefault();

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
  const photoDims = getDisplayDimensions(photo) ?? undefined;

  // ── Zoom & Pan ─────────────────────────────────────────────────────────
  const zoom = useLightboxZoomPan({ photoDims, showInfo, imgRef });

  // ── Queries ────────────────────────────────────────────────────────────
  const detailQuery = api.photo.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const detail = detailQuery.data;

  const facesQuery = api.photo.getPhotoFaces.useQuery(
    { photoId: photo.id },
    { enabled: showInfo },
  );
  const faces = facesQuery.data;

  const ocrQuery = api.photo.getPhotoOcrResults.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const ocrResults = ocrQuery.data;

  // ── Fly animation ──────────────────────────────────────────────────────
  const thumbSrc = photo.sourceId
    ? thumbUrl("photo", photo.id, THUMB_WIDTH)
    : undefined;

  const fly = useLightboxFly({
    photo,
    showInfo,
    detail: detail ?? undefined,
    thumbSrc,
    animSourceSelector,
    onClose,
  });

  // ── Image loading ──────────────────────────────────────────────────────
  const fullSrc = photo.sourceId ? photoImageUrl(photo.id) : undefined;
  const image = useLightboxImage({
    photoId: photo.id,
    fullSrc,
    animState: fly.animState,
  });

  // Reset live video on photo navigation
  const isLive = !!photo.liveVideoPath;
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const [showLiveVideo, setShowLiveVideo] = useState(false);
  const prevPhotoId = useRef(photo.id);
  if (prevPhotoId.current !== photo.id) {
    prevPhotoId.current = photo.id;
    zoom.resetZoom();
    setShowLiveVideo(false);
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") fly.handleAnimatedClose();
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
    fly.handleAnimatedClose,
    onNavigate,
    photo,
    onToggleFavorite,
    toggleInfo,
  ]);

  const isFav = detail?.isFavorite ?? photo.isFavorite;

  // ── Animation-derived values ───────────────────────────────────────────
  const showFlyImage = fly.animState !== "open" && fly.flyRect != null;
  const contentVisible = fly.animState === "open";
  const isExitFade = fly.animState === "exiting" && fly.flyRect == null;

  const thumbDisplaySize = useMemo(() => {
    if (!photoDims) return undefined;
    return computeThumbDisplaySize(photoDims.width, photoDims.height, showInfo);
  }, [photoDims, showInfo]);

  let backdropOpacity: number;
  if (fly.animState === "open") {
    backdropOpacity = 1;
  } else if (fly.animState === "entering") {
    backdropOpacity = fly.flyTransition ? 1 : 0;
  } else {
    backdropOpacity = fly.flyRect != null && !fly.flyTransition ? 1 : 0;
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

      {/* Flying image overlay */}
      {showFlyImage && fly.flyRect && (
        <FlyImage fly={fly} thumbSrc={thumbSrc} />
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
        <div className="relative flex flex-1 flex-col">
          <LightboxToolbar
            isLive={isLive}
            showLiveVideo={showLiveVideo}
            setShowLiveVideo={setShowLiveVideo}
            liveVideoRef={liveVideoRef}
            onToggleFavorite={onToggleFavorite}
            photo={photo}
            isFav={isFav}
            toggleInfo={toggleInfo}
            onClose={fly.handleAnimatedClose}
          />
          {hasPrev && (
            <button
              type="button"
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
              onClick={() => onNavigate(allPhotos[idx - 1])}
            >
              ‹
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
              onClick={() => onNavigate(allPhotos[idx + 1])}
            >
              ›
            </button>
          )}
          <div
            ref={zoom.imageContainerRef}
            role="application"
            className="flex flex-1 items-center justify-center overflow-hidden select-none p-12"
            style={{
              touchAction: "none",
              cursor: zoom.dragging
                ? "grabbing"
                : zoom.isZoomed
                  ? "grab"
                  : "default",
            }}
            onPointerDown={zoom.handlePointerDown}
            onPointerMove={zoom.handlePointerMove}
            onPointerUp={zoom.handlePointerUp}
            onPointerCancel={zoom.handlePointerUp}
            onDoubleClick={zoom.handleDoubleClick}
            onDragStart={preventDrag}
          >
            {thumbSrc || fullSrc ? (
              <div
                className="relative inline-block max-h-full max-w-full"
                style={{
                  transform: `translate(${zoom.panX}px, ${zoom.panY}px) scale(${zoom.scale})`,
                  transformOrigin: "center center",
                  transition: zoom.dragging
                    ? "none"
                    : "transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)",
                }}
              >
                {thumbSrc && !image.fullDecoded && (
                  <img
                    ref={image.fullDecoded ? undefined : imgRef}
                    src={thumbSrc}
                    alt={photo.title || photo.filename}
                    className="max-h-[calc(100vh-6rem)] max-w-full select-none pointer-events-none object-contain"
                    style={thumbDisplaySize}
                  />
                )}
                {image.fullBlobUrl && (
                  <img
                    ref={image.fullDecoded ? imgRef : undefined}
                    src={image.fullBlobUrl}
                    alt={photo.title || photo.filename}
                    className={`max-h-[calc(100vh-6rem)] max-w-full select-none pointer-events-none object-contain ${!image.fullDecoded ? "absolute inset-0 opacity-0" : ""}`}
                    onLoad={() => image.setFullDecoded(true)}
                  />
                )}
                {image.shouldLoadFull && !image.fullLoaded && fullSrc && (
                  <LoadingProgress
                    decoding={image.decoding}
                    progress={image.loadProgress}
                  />
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
                      orientation={detail.orientation}
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
                      orientation={detail.orientation}
                    />
                  )}
                {ocrResults &&
                  ocrResults.length > 0 &&
                  detail?.width &&
                  detail?.height && (
                    <OcrBlockSelectLayer
                      ocrResults={ocrResults}
                      photoWidth={detail.width}
                      photoHeight={detail.height}
                      imgRef={imgRef}
                      isZoomed={zoom.isZoomed}
                      onSelectionRanges={setOcrSelectionRanges}
                      orientation={detail.orientation}
                    />
                  )}
                {isLive && showLiveVideo && (
                  <video
                    ref={liveVideoRef}
                    src={photoLiveVideoUrl(photo.id)}
                    className="absolute inset-0 h-full w-full object-contain"
                    muted
                    playsInline
                    loop
                  />
                )}
              </div>
            ) : (
              <div className="text-fg-muted">无法加载图片</div>
            )}
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70">
            {idx + 1} / {allPhotos.length} — {photo.filename}
            {zoom.isZoomed && (
              <span className="ml-2 text-white/50">
                {Math.round(zoom.scale * 100)}%
              </span>
            )}
          </div>
        </div>
        {showInfo && (
          <PhotoInfoSidebar
            detail={detail ?? undefined}
            photo={photo}
            hoveredFaceId={hoveredFaceId}
            onHoverFace={setHoveredFaceId}
            hoveredOcrId={hoveredOcrId}
            onHoverOcr={setHoveredOcrId}
            ocrSelectionRanges={ocrSelectionRanges}
            onNavigateToPerson={onNavigateToPerson}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function FlyImage({
  fly,
  thumbSrc,
}: {
  fly: ReturnType<typeof useLightboxFly>;
  thumbSrc: string | undefined;
}) {
  if (!fly.flyRect) return null;
  const clipped = fly.sourceClippedRef.current;
  let flyOpacity: number;
  let opacityTransition: string;
  if (!clipped) {
    flyOpacity = 1;
    opacityTransition = "";
  } else if (fly.animState === "entering") {
    flyOpacity = fly.flyTransition ? 1 : 0;
    opacityTransition = `opacity ${ANIM_DURATION}ms ${FADE_IN_EASING}`;
  } else {
    flyOpacity = fly.flyTransition ? 0 : 1;
    opacityTransition = `opacity ${ANIM_DURATION}ms ${FADE_OUT_EASING}`;
  }
  const posTransition = `top ${ANIM_DURATION}ms ${ANIM_EASING}, left ${ANIM_DURATION}ms ${ANIM_EASING}, width ${ANIM_DURATION}ms ${ANIM_EASING}, height ${ANIM_DURATION}ms ${ANIM_EASING}, border-radius ${ANIM_DURATION}ms ${ANIM_EASING}`;
  return (
    <div
      className="pointer-events-none fixed overflow-hidden"
      style={{
        zIndex: 20,
        top: fly.flyRect.top,
        left: fly.flyRect.left,
        width: fly.flyRect.width,
        height: fly.flyRect.height,
        opacity: flyOpacity,
        borderRadius: fly.flyTransition
          ? fly.animState === "entering"
            ? 0
            : 6
          : fly.animState === "entering"
            ? 6
            : 0,
        transition: fly.flyTransition
          ? [posTransition, opacityTransition].filter(Boolean).join(", ")
          : "none",
        willChange: "top, left, width, height, opacity",
      }}
    >
      <img src={thumbSrc} alt="" className="h-full w-full object-cover" />
    </div>
  );
}

function LightboxToolbar({
  isLive,
  showLiveVideo,
  setShowLiveVideo,
  liveVideoRef,
  onToggleFavorite,
  photo,
  isFav,
  toggleInfo,
  onClose,
}: {
  isLive: boolean;
  showLiveVideo: boolean;
  setShowLiveVideo: React.Dispatch<React.SetStateAction<boolean>>;
  liveVideoRef: React.RefObject<HTMLVideoElement | null>;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  photo: PhotoOutput;
  isFav: boolean;
  toggleInfo: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
      {isLive && (
        <button
          type="button"
          className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-white transition-colors ${showLiveVideo ? "bg-white/30 ring-1 ring-white/50" : "bg-black/50 hover:bg-black/70"}`}
          onClick={() =>
            setShowLiveVideo((v) => {
              const next = !v;
              if (next)
                requestAnimationFrame(() =>
                  liveVideoRef.current?.play().catch(() => {}),
                );
              else if (liveVideoRef.current) {
                liveVideoRef.current.pause();
                liveVideoRef.current.currentTime = 0;
              }
              return next;
            })
          }
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
            className={`h-5 w-5 ${isFav ? "fill-red-500 text-red-500" : "text-white"}`}
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
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

function LoadingProgress({
  decoding,
  progress,
}: {
  decoding: boolean;
  progress: number;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/10">
        {decoding ? (
          <div
            className="h-full w-1/4 rounded-full bg-white/40"
            style={{
              animation: "progress-indeterminate 1.4s ease-in-out infinite",
            }}
          />
        ) : (
          <div
            className="h-full rounded-full bg-white/30"
            style={{
              width: `${progress * 100}%`,
              transition: "width 150ms ease-out",
            }}
          />
        )}
      </div>
    </div>
  );
}
