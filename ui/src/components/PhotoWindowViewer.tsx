/**
 * PhotoWindowViewer — In-window photo viewer with zoom/pan, navigation,
 * and a fullscreen button that opens the existing PhotoLightbox.
 */

import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Info,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../generated/rust-api";
import type { PhotoOutput } from "../../generated/rust-types";
import { useWindowActions } from "../../system";
import type { WindowState } from "../../system/window/window-types";
import { PhotoLightbox } from "./PhotoLightbox";
import { getViewerPhotos } from "./photo-viewer-store";

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const THUMB_W = 640;

interface Props {
  win: WindowState;
}

export const PhotoWindowViewer = memo(function PhotoWindowViewer({
  win,
}: Props) {
  const appId = win.appId ?? "";
  const initialPhotoId = win.sourceId ?? "";
  const { updateTitle, updateMetadata } = useWindowActions();

  // Track current photo in component state for navigation
  const [currentPhotoId, setCurrentPhotoId] = useState(initialPhotoId);

  // Photo list from the store (shared by PhotoAppPage)
  const photos = useMemo(() => getViewerPhotos(appId), [appId]);
  const currentIndex = useMemo(
    () => photos.findIndex((p) => p.id === currentPhotoId),
    [photos, currentPhotoId],
  );
  const photo: PhotoOutput | null = photos[currentIndex] ?? null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  // ── Image loading ──────────────────────────────────────────────
  const thumbUrl = `/api/photos/${currentPhotoId}/thumbnail?w=${THUMB_W}`;
  const fullUrl = `/api/photos/${currentPhotoId}/image`;
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load full-res image in background
  useEffect(() => {
    if (fullLoaded) return;
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(fullUrl, { signal: abort.signal });
        if (!res.ok || abort.signal.aborted) return;
        const blob = await res.blob();
        if (abort.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        setFullBlobUrl(url);
        setFullLoaded(true);
      } catch {
        // Aborted or network error — ignore
      }
    })();

    return () => {
      abort.abort();
    };
  }, [fullUrl, fullLoaded]);

  // Clean up blob URL on unmount or photo change
  useEffect(() => {
    return () => {
      if (fullBlobUrl) URL.revokeObjectURL(fullBlobUrl);
    };
  }, [fullBlobUrl]);

  // Reset state when navigating to different photo
  const navigate = useCallback(
    (dir: -1 | 1) => {
      const newIdx = currentIndex + dir;
      if (newIdx < 0 || newIdx >= photos.length) return;
      const p = photos[newIdx];
      // Clean up old blob
      if (fullBlobUrl) URL.revokeObjectURL(fullBlobUrl);
      setFullBlobUrl(null);
      setFullLoaded(false);
      setScale(1);
      setPanX(0);
      setPanY(0);
      setCurrentPhotoId(p.id);
      updateTitle(win.id, p.filename);
      updateMetadata(win.id, { photoId: p.id } as Record<string, unknown>);
    },
    [currentIndex, photos, fullBlobUrl, win.id, updateTitle, updateMetadata],
  );

  // ── Zoom & Pan ─────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Native wheel handler (passive: false for preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.002;
      setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s + delta * s)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (scale <= 1) return;
      isDragging.current = true;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
    },
    [scale, panX, panY],
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setPanX(dragStart.current.panX + e.clientX - dragStart.current.x);
    setPanY(dragStart.current.panY + e.clientY - dragStart.current.y);
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    setDragging(false);
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setPanX(0);
    setPanY(0);
  }, []);

  // ── Info panel ─────────────────────────────────────────────────
  const [showInfo, setShowInfo] = useState(false);
  const detailQuery = api.app.getPhoto.useQuery(
    { photoId: currentPhotoId },
    { enabled: showInfo },
  );
  const detail = detailQuery.data;

  // ── Favorite ───────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const favMutation = api.app.togglePhotoFavorite.useMutation();
  const handleFavorite = useCallback(() => {
    if (!photo) return;
    favMutation.mutate(
      { photoId: photo.id },
      {
        onSuccess: () => {
          api.app.getPhoto.invalidate(queryClient, {
            photoId: photo.id,
          });
        },
      },
    );
  }, [photo, favMutation, queryClient]);

  // ── Fullscreen lightbox ────────────────────────────────────────
  const [showLightbox, setShowLightbox] = useState(false);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showLightbox) return; // Let lightbox handle its own keys
      switch (e.key) {
        case "ArrowLeft":
          if (hasPrev) navigate(-1);
          break;
        case "ArrowRight":
          if (hasNext) navigate(1);
          break;
        case "i":
          setShowInfo((v) => !v);
          break;
        case "f":
          handleFavorite();
          break;
        case "0":
          resetZoom();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasPrev, hasNext, navigate, handleFavorite, resetZoom, showLightbox]);

  const displaySrc = fullBlobUrl ?? thumbUrl;
  const scalePercent = Math.round(scale * 100);

  return (
    <div className="flex h-full bg-neutral-950">
      {/* Image area */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: zoom/pan canvas needs mouse events */}
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden ${
          scale > 1
            ? dragging
              ? "cursor-grabbing"
              : "cursor-grab"
            : "cursor-default"
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={displaySrc}
          alt={photo?.filename ?? ""}
          draggable={false}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain select-none"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 0.15s ease-out",
            imageRendering: scale > 2 ? "pixelated" : "auto",
          }}
        />

        {/* Loading indicator for full-res */}
        {!fullLoaded && (
          <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/50">
            加载原图...
          </div>
        )}
      </div>

      {/* Info panel */}
      {showInfo && detail && (
        <div className="w-64 shrink-0 overflow-y-auto border-l border-white/[0.06] bg-neutral-900/80 px-3 py-3 text-xs text-white/70">
          <h3 className="mb-2 text-sm font-semibold text-white/90">
            {detail.title || detail.filename}
          </h3>
          {detail.description && (
            <p className="mb-3 text-white/50">{detail.description}</p>
          )}
          <dl className="space-y-1.5">
            {detail.takenAt && (
              <>
                <dt className="text-white/40">拍摄时间</dt>
                <dd>{new Date(detail.takenAt).toLocaleString()}</dd>
              </>
            )}
            {detail.cameraMake && (
              <>
                <dt className="text-white/40">相机</dt>
                <dd>
                  {detail.cameraMake} {detail.cameraModel}
                </dd>
              </>
            )}
            {detail.width && detail.height && (
              <>
                <dt className="text-white/40">分辨率</dt>
                <dd>
                  {detail.width} × {detail.height}
                </dd>
              </>
            )}
            {detail.fileSize != null && (
              <>
                <dt className="text-white/40">大小</dt>
                <dd>{formatSize(detail.fileSize)}</dd>
              </>
            )}
            {detail.focalLength != null && (
              <>
                <dt className="text-white/40">焦距</dt>
                <dd>{detail.focalLength}mm</dd>
              </>
            )}
            {detail.aperture != null && (
              <>
                <dt className="text-white/40">光圈</dt>
                <dd>f/{detail.aperture}</dd>
              </>
            )}
            {detail.iso != null && (
              <>
                <dt className="text-white/40">ISO</dt>
                <dd>{detail.iso}</dd>
              </>
            )}
            {detail.shutterSpeed && (
              <>
                <dt className="text-white/40">快门</dt>
                <dd>{detail.shutterSpeed}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        {/* Left: navigation */}
        <div className="flex items-center gap-1">
          <ToolBtn
            onClick={() => navigate(-1)}
            disabled={!hasPrev}
            title="上一张 (←)"
          >
            <ChevronLeft size={16} />
          </ToolBtn>
          {photos.length > 0 && (
            <span className="min-w-[60px] text-center text-[11px] text-white/40">
              {currentIndex + 1} / {photos.length}
            </span>
          )}
          <ToolBtn
            onClick={() => navigate(1)}
            disabled={!hasNext}
            title="下一张 (→)"
          >
            <ChevronRight size={16} />
          </ToolBtn>
        </div>

        {/* Center: zoom */}
        <div className="flex items-center gap-1">
          <ToolBtn
            onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.3))}
            title="缩小"
          >
            <ZoomOut size={14} />
          </ToolBtn>
          <button
            type="button"
            onClick={resetZoom}
            className="min-w-[48px] rounded px-1.5 py-1 text-center text-[11px] text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors"
            title="重置缩放 (0)"
          >
            {scalePercent}%
          </button>
          <ToolBtn
            onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.3))}
            title="放大"
          >
            <ZoomIn size={14} />
          </ToolBtn>
          <ToolBtn onClick={resetZoom} title="重置 (0)">
            <RotateCcw size={13} />
          </ToolBtn>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <ToolBtn onClick={handleFavorite} title="收藏 (F)">
            <Heart
              size={14}
              className={photo?.isFavorite ? "fill-red-400 text-red-400" : ""}
            />
          </ToolBtn>
          <ToolBtn
            onClick={() => setShowInfo((v) => !v)}
            active={showInfo}
            title="信息 (I)"
          >
            <Info size={14} />
          </ToolBtn>
          <ToolBtn onClick={() => setShowLightbox(true)} title="全屏查看">
            <Maximize size={14} />
          </ToolBtn>
        </div>
      </div>

      {/* Fullscreen lightbox overlay */}
      {showLightbox && photo && (
        <PhotoLightbox
          photo={photo}
          allPhotos={photos}
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

// ── Toolbar button ─────────────────────────────────────────────────
function ToolBtn({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active
          ? "bg-white/20 text-white"
          : "text-white/60 hover:bg-white/10 hover:text-white/90"
      } disabled:opacity-25 disabled:pointer-events-none`}
    >
      {children}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
