import { useVirtualizer } from "@tanstack/react-virtual";
import { Spin } from "@tokiomo/components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeJustifiedRows,
  type JustifiedRow,
} from "@/apps/photo/hooks/useJustifiedLayout";
import type { PhotoOutput } from "@/generated/rust-api";
import { useWindowActions } from "@/system";
import { getDefaultSize } from "@/system/window/window-sync";
import { DateHeader } from "./DateHeader";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { type DateGroup, groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";

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
  hasNewer,
  onLoadNewer,
  isLoadingNewer,
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
  hasNewer?: boolean;
  onLoadNewer?: () => void;
  isLoadingNewer?: boolean;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
  onSeekToDate?: (datePrefix: string) => void;
  targetRowHeight?: number;
}) {
  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const { openWindow } = useWindowActions();

  const handlePhotoClick = useCallback(
    (photo: PhotoOutput) => {
      // Calculate center position relative to parent window
      const parentEl = measureRef.current?.closest(
        "[data-window-id]",
      ) as HTMLElement | null;
      const parentRect = parentEl?.getBoundingClientRect();
      const childSize = getDefaultSize("image");
      // Read info panel state to adjust fly animation target
      let infoW = 0;
      try {
        if (localStorage.getItem("photo-viewer-info-panel-open") === "true")
          infoW = 320;
      } catch {}
      let initialX: number | undefined;
      let initialY: number | undefined;
      if (parentRect) {
        initialX = Math.max(
          0,
          parentRect.left + (parentRect.width - childSize.width) / 2,
        );
        initialY = Math.max(
          0,
          parentRect.top + (parentRect.height - childSize.height) / 2,
        );
      }

      // Fly animation: thumbnail → window target
      const thumbEl = document.querySelector(
        `[data-photo-id="${photo.id}"]`,
      ) as HTMLElement | null;
      if (thumbEl && initialX != null && initialY != null) {
        const thumbRect = thumbEl.getBoundingClientRect();
        const thumbImg = thumbEl.querySelector("img");
        if (thumbImg) {
          // Target is the image area within the window (excludes info panel)
          const targetW = childSize.width - infoW;
          const flyEl = document.createElement("div");
          flyEl.style.cssText = `
            position: fixed; z-index: 99999; pointer-events: none;
            left: ${thumbRect.left}px; top: ${thumbRect.top}px;
            width: ${thumbRect.width}px; height: ${thumbRect.height}px;
            border-radius: 4px; overflow: hidden;
            transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
          `;
          const img = document.createElement("img");
          img.src = thumbImg.src;
          img.style.cssText = "width: 100%; height: 100%; object-fit: cover;";
          flyEl.appendChild(img);
          document.body.appendChild(flyEl);
          // Trigger reflow, then animate
          flyEl.getBoundingClientRect();
          requestAnimationFrame(() => {
            // Offset by title bar height (36px) so image aligns with content area
            flyEl.style.left = `${initialX}px`;
            flyEl.style.top = `${(initialY ?? 0) + 36}px`;
            flyEl.style.width = `${targetW}px`;
            flyEl.style.height = `${childSize.height - 36}px`;
            flyEl.style.borderRadius = "8px";
            img.style.objectFit = "contain";
          });
          setTimeout(() => {
            flyEl.remove();
            window.dispatchEvent(new CustomEvent("photo-fly-end"));
          }, 350);
        }
      }

      openWindow({
        type: "image",
        title: photo.filename,
        route: `/photos/${photo.id}`,
        appId,
        sourceType: "photo",
        sourceId: photo.id,
        initialX,
        initialY,
      });
    },
    [openWindow, appId],
  );

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

  // ── Maintain scroll position when upward items are prepended ──
  const prevFirstDateRef = useRef<string | null>(null);
  const prevFirstDateOffsetRef = useRef(0);
  useEffect(() => {
    if (flatItems.length === 0) return;
    const firstHeader = flatItems.find((item) => item.type === "header");
    const firstDate =
      firstHeader?.type === "header" ? firstHeader.group.date : null;
    const prevFirst = prevFirstDateRef.current;
    const prevOffset = prevFirstDateOffsetRef.current;

    if (
      prevFirst &&
      firstDate &&
      firstDate !== prevFirst &&
      scrollElRef.current
    ) {
      // Items were prepended — adjust scroll to maintain visual position
      const newOffset = dateOffsets.get(prevFirst) ?? 0;
      const delta = newOffset - prevOffset;
      if (delta > 0) {
        scrollElRef.current.scrollTop += delta;
      }
    }

    // Update tracking refs
    prevFirstDateRef.current = firstDate;
    prevFirstDateOffsetRef.current = firstDate
      ? (dateOffsets.get(firstDate) ?? 0)
      : 0;
  }, [flatItems, dateOffsets]);

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

  // ── Upward infinite scroll: load newer photos when near top ──
  useEffect(() => {
    if (!hasNewer || !onLoadNewer || isLoadingNewer) return;
    const firstItem = virtualItems[0];
    if (!firstItem) return;
    if (firstItem.index <= 10) {
      onLoadNewer();
    }
  }, [virtualItems, hasNewer, onLoadNewer, isLoadingNewer]);

  // ── Pending seek: scroll after backend data arrives ──────────
  const pendingSeekRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingSeekRef.current) return;
    const target = pendingSeekRef.current;
    let idx = flatItems.findIndex(
      (item) => item.type === "header" && item.group.date.startsWith(target),
    );
    // Full-date target with no exact match → find nearest in same month
    if (idx < 0 && target.length === 10) {
      const monthPrefix = target.slice(0, 7);
      const targetDay = Number.parseInt(target.slice(8, 10), 10);
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < flatItems.length; i++) {
        const item = flatItems[i];
        if (item.type === "header" && item.group.date.startsWith(monthPrefix)) {
          const day = Number.parseInt(item.group.date.slice(8, 10), 10);
          const dist = Math.abs(day - targetDay);
          if (dist < bestDist) {
            bestDist = dist;
            idx = i;
          }
        }
      }
    }
    if (idx >= 0) {
      pendingSeekRef.current = null;
      virtualizer.scrollToIndex(idx, { align: "start", behavior: "auto" });
    }
  }, [flatItems, virtualizer]);

  // ── Scroll to date (for timeline scrubber) ──────────────────
  const scrollToDate = useCallback(
    (datePrefix: string, smooth: boolean) => {
      // Find exact header matching the date prefix.
      // datePrefix can be "YYYY-MM-DD" (scrubber full date) or "YYYY-MM" (legacy).
      // NOTE: we intentionally do NOT fall back to nearest-day-in-same-month here.
      // If the exact target day isn't loaded yet (common when scrubbing far from the
      // currently loaded window), the correct action is a backend seek to reload
      // around the target — not silently scrolling to whatever stray day from the
      // same month happens to be in flatItems (which caused "clicking 3-15 always
      // lands on 3-31" when March was only partially loaded).
      const idx = flatItems.findIndex(
        (item) =>
          item.type === "header" && item.group.date.startsWith(datePrefix),
      );

      if (idx >= 0) {
        pendingSeekRef.current = null;
        virtualizer.scrollToIndex(idx, {
          align: "start",
          behavior: smooth ? "smooth" : "auto",
        });
      } else if (onSeekToDate) {
        // Target date not loaded yet — remember target and seek via backend.
        // pendingSeekRef useEffect will then scroll (with nearest-in-month
        // fallback) once the new page arrives.
        pendingSeekRef.current = datePrefix;
        onSeekToDate(datePrefix);
      }
    },
    [flatItems, virtualizer, onSeekToDate],
  );

  // ── Current visible date (for scroll spy) ───────────────────
  // We need the LAST header at-or-above the scroll position, not merely the
  // first header in virtualItems (which includes overscan items above viewport).
  const currentVisibleDate = useMemo(() => {
    if (virtualItems.length === 0) return null;
    const scrollTop = scrollElRef.current?.scrollTop ?? 0;

    // Find the last header whose top is at or above the current scroll position.
    // vItem.start is the item's absolute offset from the scroll container top.
    let current: string | null = null;
    for (const vItem of virtualItems) {
      // Stop scanning once we've passed the scroll position (+ one header height)
      if (vItem.start > scrollTop + HEADER_HEIGHT) break;
      const item = flatItems[vItem.index];
      if (item?.type === "header") current = item.group.date;
      else if (item?.type === "row" && current === null)
        current = item.groupDate;
    }

    if (current !== null) return current;

    // Fallback: nothing found above scroll position (near top) — use first item
    const first = flatItems[virtualItems[0].index];
    if (first?.type === "header") return first.group.date;
    if (first?.type === "row") return first.groupDate;
    return null;
  }, [virtualItems, flatItems]);

  return (
    <>
      <div ref={measureRef} className="pr-14 lg:pr-14">
        {/* Upward loading indicator */}
        {hasNewer && isLoadingNewer && (
          <div className="flex justify-center py-4">
            <Spin size="small" />
          </div>
        )}
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
                      appId={appId}
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
                          onClick={handlePhotoClick}
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
            <Spin size="small" />
          </div>
        )}

        {/* Photo count footer */}
        {!hasMore && photos.length > 0 && total != null && (
          <div className="py-4 text-center text-xs text-fg-muted">
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
    </>
  );
}
