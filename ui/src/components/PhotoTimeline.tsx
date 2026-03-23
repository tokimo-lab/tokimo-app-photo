import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";

export function PhotoTimeline({
  photos,
  libraryId,
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
  libraryId: string;
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
            <div className="group/date mb-1.5 flex items-center gap-2 py-1">
              {/* Select-all checkbox — visible on hover or when selecting */}
              <button
                type="button"
                className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-all ${
                  isSelecting &&
                  group.photos.every((p) => selectedIds?.has(p.id))
                    ? "border-orange-500 bg-orange-500 opacity-100"
                    : isSelecting
                      ? "border-neutral-400 bg-neutral-200/50 opacity-80 hover:opacity-100 dark:border-neutral-500 dark:bg-neutral-700/50"
                      : "border-neutral-400 bg-neutral-200/50 opacity-0 group-hover/date:opacity-80 dark:border-neutral-500 dark:bg-neutral-700/50"
                }`}
                onClick={() => {
                  if (!onSelect) return;
                  const allSelected = group.photos.every((p) =>
                    selectedIds?.has(p.id),
                  );
                  for (const p of group.photos) {
                    if (allSelected || !selectedIds?.has(p.id)) onSelect(p);
                  }
                }}
                title={`全选 ${group.label}`}
              >
                {isSelecting &&
                  group.photos.every((p) => selectedIds?.has(p.id)) && (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  )}
              </button>
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
      <TimelineScrubber
        libraryId={libraryId}
        dateGroupRefs={dateGroupRefs.current}
      />

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
