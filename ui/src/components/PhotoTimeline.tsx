import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";
import { computeJustifiedRows } from "./useJustifiedLayout";

const PHOTO_GAP = 2;
const HEADER_HEIGHT = 32;

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

  // ── Measure available content width for justified layout ─────
  const measureRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Pre-compute justified layout for ALL groups ──────────────
  const groupLayouts = useMemo(() => {
    if (containerWidth <= 0)
      return new Map<string, ReturnType<typeof computeJustifiedRows>>();
    const map = new Map<string, ReturnType<typeof computeJustifiedRows>>();
    for (const group of groups) {
      map.set(
        group.date,
        computeJustifiedRows(group.photos, containerWidth, 220, PHOTO_GAP),
      );
    }
    return map;
  }, [groups, containerWidth]);

  // ── Track refs for each date group (timeline scrubber) ───────
  const dateGroupRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setGroupRef = useCallback((date: string, el: HTMLDivElement | null) => {
    if (el) {
      dateGroupRefs.current.set(date, el);
    } else {
      dateGroupRefs.current.delete(date);
    }
  }, []);

  // ── Infinite scroll sentinel ─────────────────────────────────
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
      <div ref={measureRef} className="pr-14 lg:pr-14">
        {groups.map((group) => {
          const rows = groupLayouts.get(group.date);
          const rowsHeight = rows
            ? rows.reduce((sum, r) => sum + r.height, 0) +
              Math.max(0, rows.length - 1) * PHOTO_GAP
            : 200;

          return (
            <div
              key={group.date}
              ref={(el) => setGroupRef(group.date, el)}
              style={{
                contentVisibility: "auto",
                containIntrinsicSize: `auto ${rowsHeight + HEADER_HEIGHT}px`,
              }}
            >
              {/* Date header */}
              <div className="group/date mb-0.5 flex items-center gap-2 py-1">
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

              {/* Justified photo rows */}
              {rows && (
                <div
                  className="flex flex-col"
                  style={{ gap: `${PHOTO_GAP}px` }}
                >
                  {rows.map((row, ri) => (
                    <div
                      key={row.items[0].photo.id}
                      className="flex"
                      style={{ gap: `${PHOTO_GAP}px`, height: row.height }}
                    >
                      {row.items.map((item) => (
                        <div
                          key={item.photo.id}
                          style={{
                            width: item.width,
                            height: item.height,
                            flexShrink: 0,
                          }}
                        >
                          <PhotoThumbnail
                            photo={item.photo}
                            onClick={setSelectedPhoto}
                            onToggleFavorite={onToggleFavorite}
                            isSelecting={isSelecting}
                            isSelected={selectedIds?.has(item.photo.id)}
                            onSelect={onSelect}
                            fillContainer
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

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
