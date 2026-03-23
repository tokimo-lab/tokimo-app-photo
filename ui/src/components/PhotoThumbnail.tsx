import { Heart, ImageIcon } from "lucide-react";
import { memo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { THUMB_WIDTH } from "./photo-utils";

export const PhotoThumbnail = memo(function PhotoThumbnail({
  photo,
  onClick,
  onToggleFavorite,
}: {
  photo: PhotoOutput;
  onClick: (photo: PhotoOutput) => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
}) {
  const src = photo.sourceId
    ? `/api/photos/${photo.id}/thumbnail?w=${THUMB_WIDTH}`
    : undefined;
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
      {/* Main click area */}
      <button
        type="button"
        className="h-full w-full cursor-pointer"
        onClick={() => onClick(photo)}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt={photo.title || photo.filename}
            className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
          </div>
        )}
      </button>

      {/* Favorite toggle */}
      {onToggleFavorite && (
        <button
          type="button"
          className={`absolute right-1 top-1 z-10 cursor-pointer rounded-full p-1.5 transition-all ${
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="truncate text-xs text-white">{photo.filename}</p>
      </div>
    </div>
  );
});
