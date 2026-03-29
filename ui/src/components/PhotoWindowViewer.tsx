/**
 * PhotoWindowViewer — In-window photo viewer with full feature parity
 * with PhotoLightbox: zoom/pan, HEIC support, face/OCR overlays,
 * edit mode, live photos, download progress, info panel, and fullscreen.
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
import { convertHeicToJpegOffThread } from "../../utils/heic-decoder";
import { LivePhotoIcon } from "./LivePhotoIcon";
import { PhotoInfoPanel } from "./PhotoInfoPanel";
import { PhotoLightbox } from "./PhotoLightbox";
import {
  FaceHighlightOverlay,
  OcrBlockSelectLayer,
  OcrHighlightOverlay,
} from "./photo-overlays";
import { THUMB_WIDTH } from "./photo-utils";
import { getViewerPhotos } from "./photo-viewer-store";

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const INFO_PANEL_STORAGE_KEY = "photo-viewer-info-panel-open";

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

  // ── Info panel state (persisted in localStorage across sessions) ──
  const [showInfo, setShowInfo] = useState(() => {
    try {
      return localStorage.getItem(INFO_PANEL_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleInfo = useCallback(() => {
    setShowInfo((v) => {
      const next = !v;
      try {
        localStorage.setItem(INFO_PANEL_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // ── Detail query (always fetch for overlays) ───────────────────
  const queryClient = useQueryClient();
  const detailQuery = api.app.getPhoto.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId },
  );
  const detail = detailQuery.data ?? undefined;

  // ── Face/OCR queries (deferred until info panel is open) ───────
  const facesQuery = api.photoSettings.getPhotoFaces.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId && showInfo },
  );
  const faces = facesQuery.data ?? [];

  const ocrQuery = api.photoSettings.getPhotoOcrResults.useQuery(
    { photoId: currentPhotoId },
    { enabled: !!currentPhotoId && showInfo },
  );
  const ocrResults = ocrQuery.data ?? [];

  // ── Hover states for overlays ──────────────────────────────────
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
  const [hoveredOcrId, setHoveredOcrId] = useState<string | null>(null);
  const [ocrSelectionRanges, setOcrSelectionRanges] = useState<
    Map<string, { start: number; end: number }>
  >(new Map());

  // ── Image loading with progress + HEIC fallback ────────────────
  const thumbUrl = `/api/photos/${currentPhotoId}/thumbnail?w=${THUMB_WIDTH}`;
  const fullUrl = `/api/photos/${currentPhotoId}/image`;
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullDecoded, setFullDecoded] = useState(false);
  // Delay thumbnail fade-out so full-res has time to paint first
  const [thumbFadeOut, setThumbFadeOut] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Show thumbnail when fly animation ends (event from PhotoTimeline),
  // with a fallback timer for cases without fly animation
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const show = () => setMounted(true);
    window.addEventListener("photo-fly-end", show);
    const fallback = setTimeout(show, 400);
    return () => {
      window.removeEventListener("photo-fly-end", show);
      clearTimeout(fallback);
    };
  }, []);

  // Delay thumbnail fade-out so full-res has time to paint first
  useEffect(() => {
    if (!fullDecoded) {
      setThumbFadeOut(false);
      return;
    }
    const timer = setTimeout(() => setThumbFadeOut(true), 50);
    return () => clearTimeout(timer);
  }, [fullDecoded]);

  const isHeic = /\.heic$/i.test(photo?.filename ?? "");

  useEffect(() => {
    if (!mounted || fullLoaded) return;
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(fullUrl, { signal: abort.signal });
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
        const testImg = new Image();
        testImg.src = url;
        try {
          await testImg.decode();
          setFullBlobUrl(url);
        } catch {
          // Native decode failed — HEIC: convert in Web Worker (off main thread)
          URL.revokeObjectURL(url);
          if (isHeic) {
            const jpegBlob = await convertHeicToJpegOffThread(blob);
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
          } else {
            // Non-HEIC decode failure: server fallback
            const jpegRes = await fetch(`${fullUrl}?format=jpeg`, {
              signal: abort.signal,
            });
            const jpegBlob = await jpegRes.blob();
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
          }
        }
        setLoadProgress(1);
        setFullLoaded(true);
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[PhotoWindowViewer] Failed to load image:", err);
          setLoadProgress(0);
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [fullUrl, fullLoaded, mounted, isHeic]);

  // Clean up blob URL on unmount
  useEffect(() => {
    const url = fullBlobUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [fullBlobUrl]);

  // ── Zoom & Pan ─────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const isDragging = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const isZoomed = scale > 1.05;

  // Track container size for thumbnail display sizing
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute display size to fit image within container (matching fly clone behavior).
  // Always constrains to container — never shows image smaller than available space.
  const displaySize = useMemo(() => {
    if (!photo?.width || !photo?.height || !containerSize.w || !containerSize.h)
      return undefined;
    const aspect = photo.width / photo.height;
    if (aspect > containerSize.w / containerSize.h) {
      return { width: containerSize.w, height: containerSize.w / aspect };
    }
    return { width: containerSize.h * aspect, height: containerSize.h };
  }, [photo?.width, photo?.height, containerSize.w, containerSize.h]);

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

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      setScale(1);
      setPanX(0);
      setPanY(0);
    } else {
      setScale(Math.min(MAX_SCALE, 2));
    }
  }, [isZoomed]);

  // ── Navigation ─────────────────────────────────────────────────
  const navigate = useCallback(
    (dir: -1 | 1) => {
      const newIdx = currentIndex + dir;
      if (newIdx < 0 || newIdx >= photos.length) return;
      const p = photos[newIdx];
      if (fullBlobUrl) URL.revokeObjectURL(fullBlobUrl);
      setFullBlobUrl(null);
      setFullLoaded(false);
      setFullDecoded(false);
      setLoadProgress(0);
      setScale(1);
      setPanX(0);
      setPanY(0);
      setHoveredFaceId(null);
      setHoveredOcrId(null);
      setOcrSelectionRanges(new Map());
      setCurrentPhotoId(p.id);
      updateTitle(win.id, p.filename);
      updateMetadata(win.id, { photoId: p.id } as Record<string, unknown>);
    },
    [currentIndex, photos, fullBlobUrl, win.id, updateTitle, updateMetadata],
  );

  // ── Favorite ───────────────────────────────────────────────────
  const favMutation = api.app.togglePhotoFavorite.useMutation();
  const handleFavorite = useCallback(() => {
    if (!photo) return;
    favMutation.mutate(
      { photoId: photo.id },
      {
        onSuccess: () => {
          api.app.getPhoto.invalidate(queryClient, { photoId: photo.id });
        },
      },
    );
  }, [photo, favMutation, queryClient]);

  // ── Edit mode ──────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDate, setEditDate] = useState("");

  const startEdit = useCallback(() => {
    if (!detail) return;
    setEditTitle(detail.title || "");
    setEditDesc(detail.description || "");
    setEditDate(detail.takenAt ? detail.takenAt.slice(0, 16) : "");
    setEditing(true);
  }, [detail]);

  const updatePhotoMutation = api.app.updatePhoto.useMutation();
  const saveEdit = useCallback(() => {
    if (!detail) return;
    updatePhotoMutation.mutate(
      {
        photoId: detail.id,
        title: editTitle || undefined,
        description: editDesc || undefined,
        takenAt: editDate || undefined,
      },
      {
        onSuccess: () => {
          setEditing(false);
          api.app.getPhoto.invalidate(queryClient, { photoId: detail.id });
        },
      },
    );
  }, [detail, editTitle, editDesc, editDate, updatePhotoMutation, queryClient]);

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

  const openFullscreen = useCallback(() => {
    setShowLightbox(true);
  }, []);

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
          resetZoom();
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
    resetZoom,
    showLightbox,
    toggleInfo,
  ]);

  const invalidateAllQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/photos/{id}"] });
    queryClient.invalidateQueries({ queryKey: ["/api/photos/{id}/faces"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/photos/{id}/ocr-results"],
    });
  }, [queryClient]);

  const scalePercent = Math.round(scale * 100);

  return (
    <div className="flex h-full bg-neutral-950">
      {/* ── Image area ─────────────────────────────────────────────── */}
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
        onDoubleClick={handleDoubleClick}
      >
        {/* Two-layer rendering: thumbnail stays visible until full-res decoded */}
        <div
          className="absolute inset-0 m-auto flex max-h-full max-w-full items-center justify-center"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
            transition: dragging ? "none" : "transform 0.15s ease-out",
          }}
        >
          {/* Thumbnail layer — hidden during fly animation, instantly visible after */}
          <img
            ref={!fullDecoded ? imgRef : undefined}
            data-photo-viewer-img=""
            src={thumbUrl}
            alt={photo?.filename ?? ""}
            draggable={false}
            className={`object-contain select-none ${
              !mounted
                ? "opacity-0"
                : thumbFadeOut
                  ? "opacity-0 transition-opacity duration-200"
                  : "opacity-100"
            }`}
            style={{
              ...(displaySize
                ? { width: displaySize.width, height: displaySize.height }
                : { width: "100%", height: "100%" }),
              imageRendering: scale > 2 ? "pixelated" : "auto",
            }}
          />
          {/* Full-res layer — fades in on top of thumbnail */}
          {fullBlobUrl && (
            <img
              ref={fullDecoded ? imgRef : undefined}
              data-photo-viewer-img=""
              src={fullBlobUrl}
              alt={photo?.filename ?? ""}
              draggable={false}
              className={`absolute inset-0 m-auto object-contain select-none transition-opacity duration-200 ${
                fullDecoded ? "opacity-100" : "opacity-0"
              }`}
              style={{
                ...(displaySize
                  ? { width: displaySize.width, height: displaySize.height }
                  : { width: "100%", height: "100%" }),
                imageRendering: scale > 2 ? "pixelated" : "auto",
              }}
              onLoad={() => setFullDecoded(true)}
            />
          )}
        </div>

        {/* Download progress bar */}
        {!fullLoaded && loadProgress > 0 && loadProgress < 1 && (
          <div className="absolute right-4 bottom-12 left-4 flex flex-col items-center gap-1">
            <div className="h-0.5 w-40 overflow-hidden rounded-full bg-white/20">
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

        {/* Loading indicator */}
        {!fullLoaded && loadProgress === 0 && (
          <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/50">
            加载原图...
          </div>
        )}

        {/* ── Overlays ─────────────────────────────────────────── */}
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
            />
          )}
        {ocrResults.length > 0 && detail?.width && detail?.height && (
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
            src={`/api/photos/${currentPhotoId}/live-video`}
            className="absolute inset-0 h-full w-full object-contain"
            muted
            playsInline
            loop
          />
        )}

        {/* Live Photo icon */}
        {isLive && (
          <button
            type="button"
            className="absolute top-3 left-3 rounded-full bg-black/50 p-1.5 text-white/70 hover:bg-black/70 hover:text-white transition-colors"
            onPointerDown={() => setShowLiveVideo(true)}
            onPointerUp={() => setShowLiveVideo(false)}
            onPointerLeave={() => setShowLiveVideo(false)}
            title="按住查看 Live Photo"
          >
            <LivePhotoIcon size={18} />
          </button>
        )}

        {/* Bottom info bar */}
        <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1 text-[11px] text-white/50">
          {photos.length > 0 && (
            <span>
              {currentIndex + 1} / {photos.length} — {photo?.filename}
            </span>
          )}
          {isZoomed && (
            <span className="ml-2 text-white/40">{scalePercent}%</span>
          )}
        </div>
      </div>

      {/* ── Info panel (full-featured, reusing PhotoInfoPanel) ───── */}
      {showInfo && (
        <div className="flex w-80 shrink-0 flex-col border-l border-[var(--border-base)] bg-[var(--sidebar-bg)] text-sm text-white backdrop-blur">
          {detail ? (
            <>
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
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <PhotoInfoPanel
                  detail={detail}
                  fallbackTitle={photo?.title || photo?.filename || ""}
                  hoveredFaceId={hoveredFaceId}
                  onHoverFace={setHoveredFaceId}
                  hoveredOcrId={hoveredOcrId}
                  onHoverOcr={setHoveredOcrId}
                  ocrSelectionRanges={ocrSelectionRanges}
                  onRefreshComplete={invalidateAllQueries}
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

      {/* ── Bottom toolbar ───────────────────────────────────────── */}
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
              className={
                (detail?.isFavorite ?? photo?.isFavorite)
                  ? "fill-red-400 text-red-400"
                  : ""
              }
            />
          </ToolBtn>
          <ToolBtn onClick={toggleInfo} active={showInfo} title="信息 (I)">
            <Info size={14} />
          </ToolBtn>
          <ToolBtn onClick={openFullscreen} title="全屏查看">
            <Maximize size={14} />
          </ToolBtn>
        </div>
      </div>

      {/* Fullscreen lightbox overlay */}
      {showLightbox && photo && (
        <PhotoLightbox
          photo={photo}
          allPhotos={photos}
          animSourceSelector="[data-photo-viewer-img]"
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
      } disabled:pointer-events-none disabled:opacity-25`}
    >
      {children}
    </button>
  );
}
