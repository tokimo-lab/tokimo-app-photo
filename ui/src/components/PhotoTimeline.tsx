import { useVirtualizer } from "@tanstack/react-virtual";
import { Spin } from "@tokimo/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  computeJustifiedRows,
  type JustifiedRow,
} from "../hooks/useJustifiedLayout";
import type { PhotoOutput } from "../generated/rust-api";
import { useComponentPreference, useViewer } from "@tokimo/sdk";
import { DateHeader } from "./DateHeader";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { type DateGroup, groupPhotosByDate } from "./photo-utils";
import { TimelineScrubber } from "./TimelineScrubber";
import { thumbUrl } from "../lib/thumb";

const PHOTO_GAP = 4;
const HEADER_HEIGHT = 30;
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
  const viewer = useViewer();
  const infoPanelPref = useComponentPreference<{ open?: boolean }>(
    "photo-viewer-info",
  );
  const infoPanelOpenRef = useRef(infoPanelPref.data.open ?? false);
  infoPanelOpenRef.current = infoPanelPref.data.open ?? false;

  const handlePhotoClick = useCallback(
    (photo: PhotoOutput) => {
      // Calculate center position relative to parent window
      const parentEl = measureRef.current?.closest(
        "[data-window-id]",
      ) as HTMLElement | null;
      const parentRect = parentEl?.getBoundingClientRect();
      const childSize = { width: 900, height: 600 };
      // Read info panel state to adjust fly animation target
      let infoW = 0;
      if (infoPanelOpenRef.current) infoW = 320;
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

      const viewerOptions: Parameters<typeof viewer.openViewer>[0] & {
        metadata: Record<string, unknown>;
      } = {
        type: "image",
        title: photo.filename,
        route: `/photos/${photo.id}`,
        metadata: {
          appId,
          sourceType: "photo",
          sourceId: photo.id,
          dataSource: photos.map((p) => ({
            id: p.id,
            src: `/api/apps/photo/item/${p.id}/image`,
            thumbnail: thumbUrl("photo", p.id, 300),
            width: p.width,
            height: p.height,
            alt: p.filename,
          })),
          index: photos.findIndex((p) => p.id === photo.id),
        },
      };
      viewer.openViewer(viewerOptions);
    },
    [viewer, appId, photos],
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
  // Strategy: use ResizeObserver on the inner list element. When the
  // list height grows, that growth came from EITHER append (bottom) or
  // prepend (top). We distinguish by tracking the first item's date —
  // if it changed, the growth was a prepend, and we add the height
  // delta to scrollTop so the user's view stays anchored.
  const prevFirstDateRef = useRef<string | null>(null);
  const prevListHeightRef = useRef(0);
  useLayoutEffect(() => {
    if (flatItems.length === 0) return;
    const firstHeader = flatItems.find((item) => item.type === "header");
    const firstDate =
      firstHeader?.type === "header" ? firstHeader.group.date : null;
    const list = listRef.current;
    const scrollEl = scrollElRef.current;
    if (!list || !scrollEl || !firstDate) {
      prevFirstDateRef.current = firstDate;
      prevListHeightRef.current = list?.offsetHeight ?? 0;
      return;
    }

    const newHeight = list.offsetHeight;
    const prevFirst = prevFirstDateRef.current;
    const prevHeight = prevListHeightRef.current;

    if (
      prevFirst !== null &&
      firstDate !== prevFirst &&
      newHeight > prevHeight
    ) {
      // Prepend detected: list grew AND the first date changed.
      const delta = newHeight - prevHeight;
      scrollEl.scrollTop += delta;
    }

    prevFirstDateRef.current = firstDate;
    prevListHeightRef.current = newHeight;
  });

  // ── Scroll element (find nearest scrollable ancestor) ────────
  const scrollElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let el = measureRef.current?.parentElement ?? null;
    while (el) {
      const ov = getComputedStyle(el).overflowY;
      if (ov === "auto" || ov === "scroll") {
        scrollElRef.current = el;
        // Set scroll-padding-top so the sticky tab bar doesn't overlap
        // anchored headers. Dynamically measured from the PillTabBar
        // wrapper (rendered with data-sticky-tab-bar="true").
        const sticky = document.querySelector<HTMLElement>(
          '[data-sticky-tab-bar="true"]',
        );
        const scrollRect = el.getBoundingClientRect();
        const stickyRect = sticky?.getBoundingClientRect();
        const overlay = stickyRect
          ? Math.max(0, stickyRect.bottom - scrollRect.top)
          : 0;
        if (overlay > 0) {
          el.style.scrollPaddingTop = `${overlay}px`;
        }
        return;
      }
      el = el.parentElement;
    }
  }, []);

  // ── Virtual scroll ───────────────────────────────────────────
  // `listRef` points at the inner positioning wrapper that contains the
  // virtual items. Its `offsetTop` is the correct `scrollMargin` for the
  // virtualizer — using `measureRef.offsetTop` would be wrong because
  // measureRef may also contain a top "loading newer" spinner that shifts
  // the real list start when shown/hidden.
  const listRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: (i) => itemHeights[i] ?? HEADER_HEIGHT,
    overscan: VIRTUALIZER_OVERSCAN,
    scrollMargin:
      listRef.current?.offsetTop ?? measureRef.current?.offsetTop ?? 0,
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

  // ── Pending-seek tracking (out-of-range seeks only) ─────────
  // When the user clicks a scrubber date that ISN'T in the currently
  // loaded data, we trigger a backend refetch via `onSeekToDate`. The
  // ref records what we're waiting for; the useLayoutEffect below
  // applies the final scroll position atomically when new data arrives.
  const pendingSeekRef = useRef<{ date: string; deadline: number } | null>(
    null,
  );

  // ── User-scroll tracking ─────────────────────────────────────
  // After a seek, the upward auto-loader is suppressed until the user
  // performs an actual scroll gesture. Without this gate, the loader
  // would fire immediately when seek lands on a date that's near the
  // top of the loaded window, pulling in NEWER photos and visually
  // pushing the seek target downward.
  const userScrolledSinceSeekRef = useRef(false);
  useEffect(() => {
    const el = scrollElRef.current;
    if (!el) return;
    const onUserScroll = () => {
      userScrolledSinceSeekRef.current = true;
    };
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchmove", onUserScroll, { passive: true });
    el.addEventListener("keydown", onUserScroll);
    return () => {
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchmove", onUserScroll);
      el.removeEventListener("keydown", onUserScroll);
    };
  }, []);

  // ── Upward infinite scroll: load newer photos when near top ──
  // Suppressed during pending seek and until the user actively scrolls,
  // to prevent the seek target from being visually pushed down by
  // background prepends.
  useEffect(() => {
    if (!hasNewer || !onLoadNewer || isLoadingNewer) return;
    if (pendingSeekRef.current) return;
    if (!userScrolledSinceSeekRef.current) return;
    const firstItem = virtualItems[0];
    if (!firstItem) return;
    if (firstItem.index <= 10) {
      onLoadNewer();
    }
  }, [virtualItems, hasNewer, onLoadNewer, isLoadingNewer]);

  // ── Header lookup ───────────────────────────────────────────
  const findHeaderIndex = useCallback(
    (target: string): { idx: number; exactDate: string } | null => {
      let idx = flatItems.findIndex(
        (item) => item.type === "header" && item.group.date.startsWith(target),
      );
      // Full-date target with no exact match → nearest day in same month
      if (idx < 0 && target.length === 10) {
        const monthPrefix = target.slice(0, 7);
        const targetDay = Number.parseInt(target.slice(8, 10), 10);
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < flatItems.length; i++) {
          const item = flatItems[i];
          if (
            item.type === "header" &&
            item.group.date.startsWith(monthPrefix)
          ) {
            const day = Number.parseInt(item.group.date.slice(8, 10), 10);
            const dist = Math.abs(day - targetDay);
            if (dist < bestDist) {
              bestDist = dist;
              idx = i;
            }
          }
        }
      }
      if (idx < 0) return null;
      const item = flatItems[idx];
      if (item?.type !== "header") return null;
      return { idx, exactDate: item.group.date };
    },
    [flatItems],
  );

  // ── Atomic scroll to a precomputed header offset ────────────
  // `dateOffsets` is computed synchronously in the same useMemo as
  // `flatItems`/`itemHeights`, using exact (not estimated) heights for
  // headers (HEADER_HEIGHT) and rows (row.height + PHOTO_GAP). This is
  // the same height calculation `estimateSize` returns to the
  // virtualizer, so the offset matches the virtualizer's layout exactly.
  // We bypass `scrollIntoView` and `virtualizer.scrollToIndex` because
  // both are async (they depend on measureElement to settle), which
  // creates the race conditions that cause off-target landings.
  const scrollToHeaderByOffset = useCallback(
    (exactDate: string, smooth: boolean): boolean => {
      const scrollEl = scrollElRef.current;
      const list = listRef.current;
      if (!scrollEl || !list) return false;
      const offset = dateOffsets.get(exactDate);
      if (offset == null) return false;
      const margin = list.offsetTop;
      const padding =
        Number.parseFloat(scrollEl.style.scrollPaddingTop || "0") || 0;
      const top = Math.max(0, margin + offset - padding);
      scrollEl.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
      return true;
    },
    [dateOffsets],
  );

  // ── Apply pending seek atomically when new data arrives ─────
  // Runs synchronously before paint whenever flatItems / dateOffsets
  // rebuild (i.e. after a refetch settles). If our pending target is
  // now in the new data, we set scrollTop in the same frame — no
  // intermediate "wrong scroll position then re-align" flicker.
  useLayoutEffect(() => {
    const pending = pendingSeekRef.current;
    if (!pending) return;
    if (Date.now() > pending.deadline) {
      pendingSeekRef.current = null;
      return;
    }
    const found = findHeaderIndex(pending.date);
    if (!found) return;
    if (scrollToHeaderByOffset(found.exactDate, false)) {
      pendingSeekRef.current = null;
      // Open the upward auto-loader immediately so the user can scroll
      // up to newer photos without first scrolling down. The list height
      // is pinned by prepend-maintain so any prepend is visually
      // transparent.
      userScrolledSinceSeekRef.current = true;
    }
  }, [findHeaderIndex, scrollToHeaderByOffset]);

  // ── Scroll to date (entry point from TimelineScrubber) ──────
  const scrollToDate = useCallback(
    (datePrefix: string, smooth: boolean) => {
      // NOTE: do NOT silently fall back to nearest-day-in-same-month for
      // the initial in-range check. If the exact day isn't loaded, the
      // right move is a backend seek to reload around the target.
      const exactMatchIdx = flatItems.findIndex(
        (item) =>
          item.type === "header" && item.group.date.startsWith(datePrefix),
      );

      // Reset prepend-tracking refs so the next prepend (after seek
      // completes) doesn't apply a stale delta — the layout is being
      // rebuilt around a new anchor.
      prevFirstDateRef.current = null;
      prevListHeightRef.current = listRef.current?.offsetHeight ?? 0;

      // Reset user-scroll flag — upward auto-loader stays suppressed
      // until the user does another wheel/touch/keyboard scroll.
      userScrolledSinceSeekRef.current = false;

      if (exactMatchIdx >= 0) {
        // In-range: scroll directly using precomputed offset. No
        // pendingSeek needed — this is fully synchronous.
        const item = flatItems[exactMatchIdx];
        if (item.type === "header") {
          pendingSeekRef.current = null;
          scrollToHeaderByOffset(item.group.date, smooth);
          // Re-open upward loader (we just reset it above).
          userScrolledSinceSeekRef.current = true;
          return;
        }
      }

      // Out-of-range: record the target, ask data hook to refetch
      // around `datePrefix`. The useLayoutEffect above will pick up the
      // new dateOffsets and apply scrollTop atomically before paint.
      pendingSeekRef.current = {
        date: datePrefix,
        deadline: Date.now() + 15000,
      };
      if (onSeekToDate) {
        onSeekToDate(datePrefix);
      }
    },
    [flatItems, scrollToHeaderByOffset, onSeekToDate],
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
      <div ref={measureRef} className="pl-4 pr-14">
        {/* Upward loading indicator */}
        {hasNewer && isLoadingNewer && (
          <div className="flex justify-center py-4">
            <Spin size="small" />
          </div>
        )}
        {/* Virtual scroll container with total height */}
        <div
          ref={listRef}
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((vItem) => {
            const item = flatItems[vItem.index];
            if (!item) return null;

            // Use a content-stable key so prepended items don't shift
            // existing items into "different content under same key" —
            // that would force PhotoThumbnail remounts (gray placeholder
            // flash). Index-based vItem.key was the cause.
            const key =
              item.type === "header"
                ? `h:${item.group.date}`
                : `r:${item.groupDate}:${item.row.items[0]?.photo.id ?? vItem.index}`;

            return (
              <div
                key={key}
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
                    data-date-header={item.group.date}
                    style={{
                      paddingLeft: PHOTO_GAP,
                      paddingRight: PHOTO_GAP,
                      height: HEADER_HEIGHT,
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
