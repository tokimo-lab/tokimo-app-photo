import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";

export function PhotoTimeline({
  photos,
  total,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
}: {
  photos: PhotoOutput[];
  total?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
}) {
  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  // Track refs for each date group for year navigator scrolling
  const dateGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setGroupRef = useCallback((date: string, el: HTMLDivElement | null) => {
    if (el) {
      dateGroupRefs.current.set(date, el);
    } else {
      dateGroupRefs.current.delete(date);
    }
  }, []);

  // Infinite scroll: observe sentinel at bottom
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isLoadingMore]);

  return (
    <>
      <div className="space-y-4 pr-14 lg:pr-14">
        {groups.map((group) => (
          <div
            key={group.date}
            ref={(el) => setGroupRef(group.date, el)}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "auto 200px",
            }}
          >
            {/* Date header */}
            <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-2 bg-neutral-50/80 py-1 backdrop-blur-sm dark:bg-neutral-900/80">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {group.label}
              </h3>
              <span className="text-xs text-neutral-400">
                {group.photos.length} 张
              </span>
            </div>

            {/* Photo grid — denser: 140px min on desktop */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-1">
              {group.photos.map((photo) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  onClick={setSelectedPhoto}
                  onToggleFavorite={onToggleFavorite}
                  isSelecting={isSelecting}
                  isSelected={selectedIds?.has(photo.id)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isLoadingMore && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
            )}
          </div>
        )}

        {/* Photo count footer */}
        {!hasMore && photos.length > 0 && total != null && (
          <div className="py-4 text-center text-xs text-neutral-400">
            共 {total} 张照片
          </div>
        )}
      </div>

      {/* Non-linear timeline scrubber on the right edge */}
      <TimelineScrubber groups={groups} dateGroupRefs={dateGroupRefs.current} />

      {selectedPhoto && !isSelecting && (
        <PhotoLightbox
          photo={selectedPhoto}
          allPhotos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </>
  );
}
