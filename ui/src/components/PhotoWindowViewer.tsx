/**
 * PhotoWindowViewer — In-window photo viewer with full feature parity
 * with PhotoLightbox: zoom/pan, HEIC support, face/OCR overlays,
 * edit mode, live photos, download progress, info panel, and fullscreen.
 */

import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../generated/rust-api";
import type { PhotoOutput } from "../generated/rust-types";
import { thumbUrl as photoThumbUrl } from "../lib/thumb";
import { useComponentPreference, useWindowActions } from "@tokimo/sdk";
import type { WindowState } from "@tokimo/sdk";
import { LivePhotoIcon } from "./LivePhotoIcon";
import { PhotoInfoSidebar } from "./PhotoInfoSidebar";
import { PhotoLightbox } from "./PhotoLightbox";
import {
  FaceHighlightOverlay,
  OcrBboxEditOverlay,
  OcrBlockSelectLayer,
  OcrHighlightOverlay,
} from "./photo-overlays";
import {
  getDisplayDimensions,
  photoLiveVideoUrl,
  THUMB_WIDTH,
} from "./photo-utils";
import { getViewerPhotos } from "./photo-viewer-store";
import { useViewerImageLoader } from "./use-viewer-image-loader";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import { ViewerToolbar } from "./ViewerToolbar";

const preventDrag = (e: React.SyntheticEvent) => e.preventDefault();

interface Props {
  win: WindowState;
}

export const PhotoWindowViewer = memo(function PhotoWindowViewer({
  win,
}: Props) {
  const appId = win.appId ?? "";
  const initialPhotoId = win.sourceId ?? "";
  const { updateTitle, updateMetadata } = useWindowActions();

  const [currentPhotoId, setCurrentPhotoId] = useState(initialPhotoId);

  // Photo list from the store (shared by PhotoAppPage)
  const photos = useMemo(() => getViewerPhotos(appId), [appId]);
  const currentIndex = useMemo(
    () => photos.findIndex((p) => p.id === currentPhotoId),
    [photos, currentPhotoId],
  );
  const storePhoto: PhotoOutput | null = photos[currentIndex] ?? null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  // ── Info panel state ───────────────────────────────────────────
  const infoPanelPref = useComponentPreference<{ open?: boolean }>(
    "photo-viewer-info",
  );
  const [showInfo, setShowInfo] = useState(
    () => infoPanelPref.data.open ?? false,
  );
  const toggleInfo = useCallback(() => {
    setShowInfo((v) => {
      const next = !v;
      infoPanelPref.patch({ open: next });
      return next;
    });
  }, [infoPanelPref]);

  // ── Queries ────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const detailQuery = api.photo.getPhoto.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId },
  );
  const detail = detailQuery.data ?? undefined;

  const photo: PhotoOutput | null =
    storePhoto ?? (detail as PhotoOutput | undefined) ?? null;

  const facesQuery = api.photo.getPhotoFaces.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId && showInfo },
  );
  const faces = facesQuery.data ?? [];

  const ocrQuery = api.photo.getPhotoOcrResults.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId && showInfo },
  );
  const ocrResults = ocrQuery.data ?? [];

  // ── Hover / OCR editing state ──────────────────────────────────
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const [hoveredOcrId, setHoveredOcrId] = useState<string | null>(null);
  const [editingOcrId, setEditingOcrId] = useState<string | null>(null);
  const [pendingBbox, setPendingBbox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null>(null);
  const handleEditOcr = useCallback((id: string | null) => {
    setEditingOcrId(id);
    setPendingBbox(null);
  }, []);

  const createOcrMut = api.photo.createOcrResult.useMutation();
  const handleAddOcr = useCallback(async () => {
    if (!detail) return;
    const pw = detail.width || 1000;
    const ph = detail.height || 1000;
    const w = Math.round(pw * 0.2);
    const h = Math.round(ph * 0.04);
    const x = Math.round((pw - w) / 2);
    const y = Math.round((ph - h) / 2);
    try {
      const result = await createOcrMut.mutateAsync({
        photoId: detail.id,
        text: "",
        x,
        y,
        w,
        h,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/apps/photo/{id}/ocr-results"],
      });
      setEditingOcrId(result.id);
      setPendingBbox(null);
    } catch {}
  }, [detail, createOcrMut, queryClient]);
  const [ocrSelectionRanges, setOcrSelectionRanges] = useState<
    Map<string, { start: number; end: number }>
  >(new Map());

  // ── Image loading ──────────────────────────────────────────────
  const imgRef = useRef<HTMLImageElement>(null);
  const thumbUrl = photoThumbUrl("photo", currentPhotoId, THUMB_WIDTH);
  const image = useViewerImageLoader({
    photoId: currentPhotoId,
    filename: photo?.filename,
  });

  // ── Zoom & Pan ─────────────────────────────────────────────────
  const zoom = useViewerZoomPan({ imgRef });

  // ── Container size for display sizing ──────────────────────────
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = zoom.containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom.containerRef]);

  const displaySize = useMemo(() => {
    const dims = getDisplayDimensions(photo);
    if (!dims || !containerSize.w || !containerSize.h) return undefined;
    const aspect = dims.width / dims.height;
    if (aspect > containerSize.w / containerSize.h) {
      return { width: containerSize.w, height: containerSize.w / aspect };
    }
    return { width: containerSize.h * aspect, height: containerSize.h };
  }, [photo, containerSize.w, containerSize.h]);

  // ── Navigation ─────────────────────────────────────────────────
  const navigate = useCallback(
    (dir: -1 | 1) => {
      const newIdx = currentIndex + dir;
      if (newIdx < 0 || newIdx >= photos.length) return;
      const p = photos[newIdx];
      image.resetImage();
      zoom.resetZoom();
      setHoveredFaceId(null);
      setHoveredOcrId(null);
      setOcrSelectionRanges(new Map());
      setCurrentPhotoId(p.id);
      updateTitle(win.id, p.filename);
      updateMetadata(win.id, { photoId: p.id } as Record<string, unknown>);
    },
    [currentIndex, photos, image, zoom, win.id, updateTitle, updateMetadata],
  );

  // ── Favorite ───────────────────────────────────────────────────
  const favMutation = api.photo.togglePhotoFavorite.useMutation();
  const handleFavorite = useCallback(() => {
    if (!photo) return;
    favMutation.mutate(
      { photoId: photo.id },
      {
        onSuccess: () =>
          api.photo.getPhoto.invalidate(queryClient, { photoId: photo.id }),
      },
    );
  }, [photo, favMutation, queryClient]);

  // ── Live Photo ─────────────────────────────────────────────────
  const isLive = !!photo?.liveVideoPath;
  const [showLiveVideo, setShowLiveVideo] = useState(false);
  const liveVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (showLiveVideo && liveVideoRef.current) {
      liveVideoRef.current.currentTime = 0;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [showLiveVideo]);

  // ── Fullscreen lightbox ────────────────────────────────────────
  const [showLightbox, setShowLightbox] = useState(false);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showLightbox) return;
      switch (e.key) {
        case "ArrowLeft":
          if (hasPrev) navigate(-1);
          break;
        case "ArrowRight":
          if (hasNext) navigate(1);
          break;
        case "i":
          toggleInfo();
          break;
        case "f":
          handleFavorite();
          break;
        case "0":
          zoom.resetZoom();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    hasPrev,
    hasNext,
    navigate,
    handleFavorite,
    zoom.resetZoom,
    showLightbox,
    toggleInfo,
  ]);

  return (
    <div className="relative flex h-full bg-neutral-950">
      {/* ── Image area ─────────────────────────────────────────────── */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: zoom/pan canvas needs mouse events */}
      <div
        ref={zoom.containerRef}
        className={`relative flex-1 overflow-hidden select-none ${
          zoom.isZoomed
            ? zoom.dragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-default"
        }`}
        style={{ touchAction: "none" }}
        onPointerDown={zoom.handlePointerDown}
        onPointerMove={zoom.handlePointerMove}
        onPointerUp={zoom.handlePointerUp}
        onPointerCancel={zoom.handlePointerUp}
        onDoubleClick={zoom.handleDoubleClick}
        onDragStart={preventDrag}
      >
        <div className="absolute inset-0 flex items-center justify-center">
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
            <img
              ref={!image.fullDecoded ? imgRef : undefined}
              data-photo-viewer-img={win.id}
              src={thumbUrl}
              alt={photo?.filename ?? ""}
              className={`max-h-full max-w-full object-contain select-none pointer-events-none ${
                !image.mounted
                  ? "opacity-0"
                  : image.thumbFadeOut
                    ? "opacity-0 transition-opacity duration-200"
                    : "opacity-100"
              }`}
              style={{
                ...(displaySize
                  ? { width: displaySize.width, height: displaySize.height }
                  : {}),
                imageRendering: zoom.scale > 2 ? "pixelated" : "auto",
              }}
            />
            {image.fullBlobUrl && (
              <img
                ref={image.fullDecoded ? imgRef : undefined}
                data-photo-viewer-img={win.id}
                src={image.fullBlobUrl}
                alt={photo?.filename ?? ""}
                className={`absolute inset-0 max-h-full max-w-full object-contain select-none pointer-events-none transition-opacity duration-200 ${image.fullDecoded ? "opacity-100" : "opacity-0"}`}
                style={{
                  ...(displaySize
                    ? { width: displaySize.width, height: displaySize.height }
                    : {}),
                  imageRendering: zoom.scale > 2 ? "pixelated" : "auto",
                }}
                onLoad={() => image.setFullDecoded(true)}
              />
            )}
            {/* Overlays */}
            {hoveredFaceId != null &&
              faces.length > 0 &&
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
            {editingOcrId != null &&
              ocrResults.length > 0 &&
              detail?.width &&
              detail?.height && (
                <OcrBboxEditOverlay
                  ocrResults={ocrResults}
                  editingOcrId={editingOcrId}
                  photoWidth={detail.width}
                  photoHeight={detail.height}
                  imgRef={imgRef}
                  onBboxChange={setPendingBbox}
                  orientation={detail.orientation}
                />
              )}
            {hoveredOcrId != null &&
              ocrResults.length > 0 &&
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
            {ocrResults.length > 0 &&
              detail?.width &&
              detail?.height &&
              editingOcrId == null && (
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
                src={photoLiveVideoUrl(currentPhotoId)}
                className="absolute inset-0 h-full w-full object-contain"
                muted
                playsInline
                loop
              />
            )}
          </div>
        </div>

        {!image.fullLoaded && image.loadProgress === 0 && (
          <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/50">
            加载原图...
          </div>
        )}

        {isLive && (
          <button
            type="button"
            className="absolute top-3 left-3 rounded-full bg-black/50 p-1.5 text-white/70 hover:bg-black/70 hover:text-white transition-colors cursor-pointer"
            onPointerDown={() => setShowLiveVideo(true)}
            onPointerUp={() => setShowLiveVideo(false)}
            onPointerLeave={() => setShowLiveVideo(false)}
            title="按住查看 Live Photo"
          >
            <LivePhotoIcon size={18} />
          </button>
        )}

        <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1 text-[11px] text-white/50">
          {photos.length > 0 && (
            <span>
              {currentIndex + 1} / {photos.length} — {photo?.filename}
            </span>
          )}
          {zoom.isZoomed && (
            <span className="ml-2 text-white/40">
              {Math.round(zoom.scale * 100)}%
            </span>
          )}
        </div>

        {image.mounted && !image.fullLoaded && (
          <div className="absolute inset-x-0 bottom-0 z-10">
            <div className="h-0.5 w-full bg-white/10 overflow-hidden">
              {image.decoding ? (
                <div
                  className="h-full w-1/4 rounded-full bg-white/40"
                  style={{
                    animation:
                      "progress-indeterminate 1.4s ease-in-out infinite",
                  }}
                />
              ) : (
                <div
                  className="h-full bg-white/30"
                  style={{
                    width: `${Math.max(image.loadProgress, 0.02) * 100}%`,
                    transition: "width 150ms ease-out",
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Info panel ─────────────────────────────────────────────── */}
      {showInfo && (
        <PhotoInfoSidebar
          detail={detail}
          photo={photo}
          hoveredFaceId={hoveredFaceId}
          onHoverFace={setHoveredFaceId}
          hoveredOcrId={hoveredOcrId}
          onHoverOcr={setHoveredOcrId}
          ocrSelectionRanges={ocrSelectionRanges}
          editingOcrId={editingOcrId}
          onEditOcr={handleEditOcr}
          pendingBbox={pendingBbox}
          onAddOcr={handleAddOcr}
        />
      )}

      {/* ── Bottom toolbar ───────────────────────────────────────── */}
      <ViewerToolbar
        hasPrev={hasPrev}
        hasNext={hasNext}
        onNavigate={navigate}
        scale={zoom.scale}
        setScale={zoom.setScale}
        maxScale={zoom.MAX_SCALE}
        onResetZoom={zoom.resetZoom}
        isFavorite={detail?.isFavorite ?? photo?.isFavorite ?? false}
        onFavorite={handleFavorite}
        showInfo={showInfo}
        onToggleInfo={toggleInfo}
        onFullscreen={() => setShowLightbox(true)}
      />

      {showLightbox && photo && (
        <PhotoLightbox
          photo={photo}
          allPhotos={photos}
          animSourceSelector={`[data-photo-viewer-img="${win.id}"]`}
          onClose={() => setShowLightbox(false)}
          onNavigate={(p) => {
            setCurrentPhotoId(p.id);
            updateTitle(win.id, p.filename);
          }}
        />
      )}
    </div>
  );
});
