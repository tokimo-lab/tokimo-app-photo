import { Check, Heart, ImageIcon } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import type { PhotoOutput } from "@/generated/rust-api";
import { thumbUrl } from "@/lib/thumb";
import { LivePhotoIcon } from "./LivePhotoIcon";
import { photoLiveVideoUrl, THUMB_WIDTH } from "./photo-utils";

// Module-level cache of photo IDs whose thumbnail has loaded at least
// once. Persists across PhotoThumbnail mount/unmount cycles so that a
// remount (e.g. caused by a virtualized list re-keying after prepend)
// does not re-show the skeleton-shimmer / opacity-0 fade-in for an
// already-loaded image. The browser's HTTP cache will return the same
// bytes immediately, but React state would otherwise reset to
// `loaded=false` until <img onLoad> fires again, producing a brief
// gray flash for every visible thumbnail. Bounded by the number of
// distinct photos viewed in this session — acceptable.
const loadedPhotoIds = new Set<string>();

export const PhotoThumbnail = memo(function PhotoThumbnail({
  photo,
  onClick,
  onToggleFavorite,
  isSelecting,
  isSelected,
  onSelect,
  fillContainer,
}: {
  photo: PhotoOutput;
  onClick: (photo: PhotoOutput) => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  isSelecting?: boolean;
  isSelected?: boolean;
  onSelect?: (photo: PhotoOutput) => void;
  /** When true, fills parent dimensions instead of forcing aspect-square */
  fillContainer?: boolean;
}) {
  const src = photo.sourceId
    ? thumbUrl("photo", photo.id, THUMB_WIDTH)
    : undefined;
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Initialize loaded from module-level cache so a remounted thumbnail
  // for a previously-loaded photo skips the skeleton/fade entirely.
  const [loaded, setLoaded] = useState(() => loadedPhotoIds.has(photo.id));
  const [errored, setErrored] = useState(false);
  const onImgRef = useCallback(
    (el: HTMLImageElement | null) => {
      imgRef.current = el;
      // Cached images may not fire onLoad after remount — detect via the
      // browser's `complete` flag at attach time as a second safety net.
      if (el?.complete && el.naturalWidth > 0) {
        loadedPhotoIds.add(photo.id);
        setLoaded(true);
      }
    },
    [photo.id],
  );
  const handleLoad = useCallback(() => {
    loadedPhotoIds.add(photo.id);
    setLoaded(true);
  }, [photo.id]);
  const [showLiveVideo, setShowLiveVideo] = useState(false);

  const isLive = !!photo.liveVideoPath;

  const handleClick = () => {
    if (isSelecting && onSelect) {
      onSelect(photo);
    } else {
      onClick(photo);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(photo);
  };

  // Ref callback: auto-play as soon as the <video> element mounts
  const liveVideoRefCb = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el) {
      el.play().catch(() => {});
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!isLive || isSelecting) return;
    setShowLiveVideo(true);
  }, [isLive, isSelecting]);

  const handleMouseLeave = useCallback(() => {
    if (!showLiveVideo) return;
    setShowLiveVideo(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [showLiveVideo]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Live Photo hover preview
    <div
      data-photo-id={photo.id}
      className={`group relative overflow-hidden rounded-md bg-fill-tertiary ${
        !loaded && !errored && src ? "skeleton-shimmer" : ""
      } ${fillContainer ? "h-full w-full" : "aspect-square"} ${
        isSelected
          ? "ring-2 ring-orange-500 ring-offset-1 ring-offset-[var(--color-surface-base)]"
          : ""
      }`}
      onMouseEnter={isLive ? handleMouseEnter : undefined}
      onMouseLeave={isLive ? handleMouseLeave : undefined}
    >
      {/* Main click area */}
      <button
        type="button"
        className="h-full w-full cursor-pointer"
        onClick={handleClick}
      >
        {src && !errored ? (
          <img
            ref={onImgRef}
            src={src}
            alt={photo.title || photo.filename}
            className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"} ${isSelected ? "brightness-90" : ""}`}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
          </div>
        )}
      </button>

      {/* Live Photo video overlay */}
      {showLiveVideo && (
        <video
          ref={liveVideoRefCb}
          src={photoLiveVideoUrl(photo.id)}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          loop
        />
      )}

      {/* Selection checkbox — top left */}
      {onSelect && (
        <button
          type="button"
          className={`absolute left-1 top-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border-2 transition-all ${
            isSelected
              ? "border-orange-500 bg-orange-500 opacity-100"
              : isSelecting
                ? "border-white/70 bg-black/30 opacity-80 hover:opacity-100"
                : "border-white/70 bg-black/30 opacity-0 group-hover:opacity-80"
          }`}
          onClick={handleCheckboxClick}
        >
          {isSelected && (
            <Check className="h-3 w-3 text-white" strokeWidth={3} />
          )}
        </button>
      )}

      {/* Live Photo badge — top right (before favorite) */}
      {isLive && !isSelecting && (
        <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-full bg-black/40 px-1.5 py-0.5 text-white opacity-80 transition-opacity group-hover:opacity-100">
          <LivePhotoIcon size={14} />
          <span className="text-[10px] font-medium leading-none">LIVE</span>
        </div>
      )}

      {/* Favorite toggle — top right (shifted down when live badge is present) */}
      {onToggleFavorite && !isSelecting && (
        <button
          type="button"
          className={`absolute right-1 z-10 cursor-pointer rounded-full p-1.5 transition-all ${
            isLive ? "top-7" : "top-1"
          } ${
            photo.isFavorite
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          } bg-black/40 hover:bg-black/60`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(photo);
          }}
        >
          <Heart
            className={`h-3.5 w-3.5 ${
              photo.isFavorite ? "fill-red-500 text-red-500" : "text-white"
            }`}
          />
        </button>
      )}

      {/* Hover overlay with filename */}
      {!isSelecting && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-xs text-white">{photo.filename}</p>
        </div>
      )}
    </div>
  );
});
