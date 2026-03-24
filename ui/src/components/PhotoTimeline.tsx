import { useVirtualizer } from "@tanstack/react-virtual";
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import type { DateGroup } from "./photo-utils";
import { groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";
import { computeJustifiedRows, type JustifiedRow } from "./useJustifiedLayout";

const PHOTO_GAP = 4;
const HEADER_HEIGHT = 32;
const VIRTUALIZER_OVERSCAN = 15;

// ── Flat virtual item types ─────────────────────────────────────
type VirtualItem =
  | { type: "header"; group: DateGroup }
  | { type: "row"; row: JustifiedRow; groupDate: string };

export function PhotoTimeline({
  photos,
  appId,
  total,
  hasMore,
  onLoadMore,
  isLoadingMore,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
  onSeekToDate,
  targetRowHeight = 220,
}: {
  photos: PhotoOutput[];
  appId: string;
  total?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
  onSeekToDate?: (datePrefix: string) => void;
  targetRowHeight?: number;
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

  // Layout width = measured width minus left+right padding (same as gap)
  const layoutWidth = Math.max(0, containerWidth - 2 * PHOTO_GAP);

  // ── Flatten groups into virtual items with pre-computed heights ──
  const { flatItems, dateOffsets, itemHeights } = useMemo(() => {
    const items: VirtualItem[] = [];
    const heights: number[] = [];
    const offsets = new Map<string, number>();
    let cumOffset = 0;

    for (const group of groups) {
      offsets.set(group.date, cumOffset);

      // Header item
      items.push({ type: "header", group });
      heights.push(HEADER_HEIGHT);
      cumOffset += HEADER_HEIGHT;

      // Photo row items
      if (layoutWidth > 0) {
        const rows = computeJustifiedRows(
          group.photos,
          layoutWidth,
          targetRowHeight,
          PHOTO_GAP,
        );
        for (const row of rows) {
          items.push({ type: "row", row, groupDate: group.date });
          const h = row.height + PHOTO_GAP;
          heights.push(h);
          cumOffset += h;
        }
      }
    }

    return { flatItems: items, dateOffsets: offsets, itemHeights: heights };
  }, [groups, layoutWidth, targetRowHeight]);

  // ── Scroll element (find nearest scrollable ancestor) ────────
  const scrollElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let el = measureRef.current?.parentElement ?? null;
    while (el) {
      const ov = getComputedStyle(el).overflowY;
      if (ov === "auto" || ov === "scroll") {
        scrollElRef.current = el;
        return;
      }
      el = el.parentElement;
    }
  }, []);

  // ── Virtual scroll ───────────────────────────────────────────
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (i) => itemHeights[i] ?? HEADER_HEIGHT,
    overscan: VIRTUALIZER_OVERSCAN,
    // Offset from scroll container top to virtualizer wrapper
    scrollMargin: measureRef.current?.offsetTop ?? 0,
  });

  // ── Infinite scroll: trigger when near end ──────────────────
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!hasMore || !onLoadMore || isLoadingMore) return;
    const lastItem = virtualItems[virtualItems.length - 1];
    if (!lastItem) return;
    // Load more when within 10 items of the end
    if (lastItem.index >= flatItems.length - 10) {
      onLoadMore();
    }
  }, [virtualItems, flatItems.length, hasMore, onLoadMore, isLoadingMore]);

  // ── Scroll to date (for timeline scrubber) ──────────────────
  const scrollToDate = useCallback(
    (datePrefix: string, smooth: boolean) => {
      // Find the first flat item whose date starts with the prefix
      const idx = flatItems.findIndex(
        (item) =>
          item.type === "header" && item.group.date.startsWith(datePrefix),
      );
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, {
          align: "start",
          behavior: smooth ? "smooth" : "auto",
        });
      } else if (onSeekToDate) {
        // Target date not loaded yet — seek via backend
        onSeekToDate(datePrefix);
      }
    },
    [flatItems, virtualizer, onSeekToDate],
  );

  // ── Current visible date (for scroll spy) ───────────────────
  const currentVisibleDate = useMemo(() => {
    if (virtualItems.length === 0) return null;
    // Find the first visible header
    for (const vItem of virtualItems) {
      const item = flatItems[vItem.index];
      if (item?.type === "header") return item.group.date;
    }
    // Fallback: find the group date from the first visible row
    const first = flatItems[virtualItems[0].index];
    if (first?.type === "row") return first.groupDate;
    return null;
  }, [virtualItems, flatItems]);

  return (
    <>
      <div ref={measureRef} className="pr-14 lg:pr-14">
        {/* Virtual scroll container with total height */}
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((vItem) => {
            const item = flatItems[vItem.index];
            if (!item) return null;

            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vItem.start - virtualizer.options.scrollMargin}px)`,
                  paddingBottom: item.type === "row" ? PHOTO_GAP : 0,
                }}
              >
                {item.type === "header" ? (
                  <div
                    style={{
                      paddingLeft: PHOTO_GAP,
                      paddingRight: PHOTO_GAP,
                    }}
                  >
                    <DateHeader
                      group={item.group}
                      isSelecting={isSelecting}
                      selectedIds={selectedIds}
                      onSelect={onSelect}
                    />
                  </div>
                ) : (
                  <div
                    className="flex"
                    style={{
                      gap: `${PHOTO_GAP}px`,
                      height: item.row.height,
                      paddingLeft: PHOTO_GAP,
                      paddingRight: PHOTO_GAP,
                    }}
                  >
                    {item.row.items.map((photo) => (
                      <div
                        key={photo.photo.id}
                        style={{
                          width: photo.width,
                          height: photo.height,
                          flexShrink: 0,
                        }}
                      >
                        <PhotoThumbnail
                          photo={photo.photo}
                          onClick={setSelectedPhoto}
                          onToggleFavorite={onToggleFavorite}
                          isSelecting={isSelecting}
                          isSelected={selectedIds?.has(photo.photo.id)}
                          onSelect={onSelect}
                          fillContainer
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Loading indicator */}
        {hasMore && isLoadingMore && (
          <div className="flex justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
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
        appId={appId}
        dateOffsets={dateOffsets}
        currentVisibleDate={currentVisibleDate}
        scrollToDate={scrollToDate}
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

// ── Date header (extracted for virtual rendering) ──────────────
function DateHeader({
  group,
  isSelecting,
  selectedIds,
  onSelect,
}: {
  group: DateGroup;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
}) {
  const allSelected =
    isSelecting && group.photos.every((p) => selectedIds?.has(p.id));

  return (
    <div
      className={`group/date relative mb-0.5 flex items-center py-1 ${
        isSelecting ? "pl-7" : "pl-0 group-hover/date:pl-7"
      }`}
      style={{
        transition: "padding-left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <button
        type="button"
        className={`absolute left-0 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 ${
          allSelected
            ? "border-orange-500 bg-orange-500 opacity-100"
            : isSelecting
              ? "border-neutral-400 bg-neutral-200/50 opacity-80 hover:opacity-100 dark:border-neutral-500 dark:bg-neutral-700/50"
              : "border-neutral-400 bg-neutral-200/50 opacity-0 group-hover/date:opacity-80 dark:border-neutral-500 dark:bg-neutral-700/50"
        }`}
        style={{
          transition:
            "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={() => {
          if (!onSelect) return;
          for (const p of group.photos) {
            if (allSelected || !selectedIds?.has(p.id)) onSelect(p);
          }
        }}
        title={`全选 ${group.label}`}
      >
        {allSelected && (
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        )}
      </button>
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {group.label}
      </h3>
      <span className="ml-2 text-xs text-neutral-400">
        {group.photos.length} 张
      </span>
    </div>
  );
}
