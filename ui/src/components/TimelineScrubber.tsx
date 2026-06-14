import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../generated/rust-api";
import { useTimelineLayout } from "./timeline-layout";

/**
 * Non-linear timeline scrubber for photo timeline.
 *
 * Right-edge vertical track with year labels spaced non-linearly:
 * recent years spread out (month-level ticks), distant years compress,
 * very old years plateau at minimum spacing — matching MT Photos UX.
 *
 * Uses backend timeline index for complete library coverage
 * (not limited to loaded photo groups).
 *
 * Supports click-to-jump and drag-to-scrub with date tooltip.
 */

// ── Component ───────────────────────────────────────────────────
export function TimelineScrubber({
  appId,
  dateOffsets: _dateOffsets,
  currentVisibleDate,
  scrollToDate,
}: {
  appId: string;
  dateOffsets: Map<string, number>;
  currentVisibleDate: string | null;
  scrollToDate: (datePrefix: string, smooth: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [thumbPos, setThumbPos] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [focusYear, setFocusYear] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    y: number; // track-relative Y
    text: string;
  } | null>(null);

  // Find window content container for portal positioning
  const anchorCallbackRef = useCallback((el: HTMLSpanElement | null) => {
    if (el) {
      const target = el.closest("[data-window-content]") as HTMLElement | null;
      setPortalTarget(target);
    }
  }, []);

  const { data: timelineEntries } = api.photo.getTimelineIndex.useQuery(
    { id: appId },
    { enabled: !!appId },
  );
  const { marks, datePositions, posToDateLabel } = useTimelineLayout(
    timelineEntries ?? [],
    focusYear,
  );

  // ── Scroll → thumb sync (driven by virtualizer's visible date) ──
  useEffect(() => {
    if (dragging || !currentVisibleDate || datePositions.size === 0) return;
    const ymd = currentVisibleDate.slice(0, 10); // "2025-03-12"
    const ym = currentVisibleDate.slice(0, 7); // "2025-03"
    if (datePositions.has(ymd)) {
      setThumbPos(datePositions.get(ymd)!);
    } else if (datePositions.has(ym)) {
      setThumbPos(datePositions.get(ym)!);
    }
  }, [currentVisibleDate, datePositions, dragging]);

  // ── Position → year-month from interpolated label ────────────
  const nearestDate = useCallback(
    (pos: number) => {
      // Return full YYYY-MM-DD so seekToDate navigates to exact day
      const label = posToDateLabel(pos);
      const match = label.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (match) {
        const year = match[1];
        const month = match[2].padStart(2, "0");
        const day = match[3].padStart(2, "0");
        return `${year}-${month}-${day}`;
      }
      // Fallback: nearest datePosition key
      let best: string | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const [ym, dp] of datePositions) {
        const d = Math.abs(dp - pos);
        if (d < bestDist) {
          bestDist = d;
          best = ym;
        }
      }
      return best;
    },
    [datePositions, posToDateLabel],
  );

  // ── Scroll to track Y coordinate ────────────────────────────
  const scrollToY = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const nearest = nearestDate(pos);
      if (nearest) {
        // Always use instant scroll — smooth scroll creates a race condition
        // where dragging ends before the scroll settles, causing the sync to
        // snap the thumb back to the old visible date.
        scrollToDate(nearest, false);
        setTooltip({ y: clientY - r.top, text: posToDateLabel(pos) });
      }
      setThumbPos(pos);
    },
    [nearestDate, posToDateLabel, scrollToDate],
  );

  // ── Mouse down on track ─────────────────────────────────────
  const onDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      scrollToY(e.clientY);
    },
    [scrollToY],
  );

  // ── Drag (global move/up) ───────────────────────────────────
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => scrollToY(e.clientY);
    const onUp = () => {
      setDragging(false);
      setTooltip(null);
      // Shift focus to where the user landed → recompute layout
      if (trackRef.current) {
        const label = posToDateLabel(thumbPos);
        const yearMatch = label.match(/^(\d{4})/);
        if (yearMatch) {
          setFocusYear(Number.parseInt(yearMatch[1], 10));
        }
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, scrollToY, thumbPos, posToDateLabel]);

  // ── Hover tooltip ───────────────────────────────────────────
  const onHover = useCallback(
    (e: React.MouseEvent) => {
      if (dragging || !trackRef.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const label = posToDateLabel(pos);
      if (label) {
        setTooltip({ y: e.clientY - r.top, text: label });
      }
    },
    [dragging, posToDateLabel],
  );

  const onLeave = useCallback(() => {
    if (!dragging) setTooltip(null);
  }, [dragging]);

  if (datePositions.size === 0)
    return <span ref={anchorCallbackRef} className="hidden" />;

  const scrubber = (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Timeline scrubber"
      aria-valuenow={Math.round(thumbPos * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-orientation="vertical"
      tabIndex={0}
      className="absolute right-0 z-30 hidden w-12 cursor-pointer select-none lg:block"
      style={{ top: "48px", bottom: "8px" }}
      onMouseDown={onDown}
      onMouseMove={onHover}
      onMouseLeave={onLeave}
    >
      {/* Vertical track line */}
      <div className="absolute left-5 top-0 bottom-0 w-px bg-neutral-400/20 dark:bg-neutral-500/20" />

      {/* Thumb indicator — thin rounded bar aligned with tick marks */}
      <div
        className="absolute left-4 right-0.5 h-[3px] rounded-full bg-orange-500/50 dark:bg-orange-400/60"
        style={{
          top: `${thumbPos * 100}%`,
          transform: "translateY(-50%)",
          transition: dragging ? "none" : "top 150ms ease-out",
        }}
      />

      {/* Year / month / day marks (rendered after thumb so text is on top) */}
      {marks.map((m) =>
        m.isYear ? (
          <span
            key={`y-${m.label}`}
            className="absolute right-1 text-[11px] font-semibold text-fg-muted"
            style={{
              top: `${m.position * 100}%`,
              transform: "translateY(-50%)",
            }}
          >
            {m.label}
          </span>
        ) : m.label ? (
          // Month label with tick
          <span
            key={`m-${m.label}-${m.position.toFixed(4)}`}
            className="absolute right-1 text-[9px] text-fg-muted/60"
            style={{
              top: `${m.position * 100}%`,
              transform: "translateY(-50%)",
            }}
          >
            {m.label}
          </span>
        ) : (
          // Day tick (no label, short mark)
          <div
            key={`d-${m.position.toFixed(6)}`}
            className="absolute left-[18px] h-px w-1 bg-neutral-400/20 dark:bg-neutral-500/20"
            style={{ top: `${m.position * 100}%` }}
          />
        ),
      )}

      {/* Tooltip (during hover/drag) — positioned relative to track */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-40 rounded-md bg-neutral-800/90 px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg dark:bg-neutral-700/95"
          style={{
            top: tooltip.y,
            right: "100%",
            marginRight: "8px",
            transform: "translateY(-50%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );

  return (
    <>
      <span ref={anchorCallbackRef} className="hidden" />
      {portalTarget ? createPortal(scrubber, portalTarget) : null}
    </>
  );
}
