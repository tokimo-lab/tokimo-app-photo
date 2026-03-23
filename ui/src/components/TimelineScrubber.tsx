import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../generated/rust-api";

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

// ── Non-linear year weight ──────────────────────────────────────
// Sigmoid curve: distance 0 → 60, transitions around 8-year mark,
// plateaus at 8. "远到一定距离后比例尺不再变大".
function yearWeight(distFromLatest: number): number {
  return 8 + 52 / (1 + (distFromLatest / 8) ** 3);
}

// ── Types ───────────────────────────────────────────────────────
interface Mark {
  position: number; // 0–1 from top
  label: string;
  isYear: boolean;
}

interface TimelineEntry {
  year: number;
  month: number;
  count: number;
}

// ── Compute timeline layout from backend entries ────────────────
function useTimelineLayout(entries: TimelineEntry[]) {
  return useMemo(() => {
    if (entries.length === 0)
      return { marks: [] as Mark[], datePositions: new Map<string, number>() };

    const years = [...new Set(entries.map((e) => e.year))].sort(
      (a, b) => b - a,
    );
    const latest = years[0];
    const marks: Mark[] = [];
    const datePositions = new Map<string, number>();

    // ── Single year: linear by month ────────────────────────────
    if (years.length === 1) {
      const months = entries.map((e) => e.month).sort((a, b) => b - a);
      const maxM = Math.max(...months);
      const minM = Math.min(...months);
      const span = maxM - minM || 1;

      marks.push({ position: 0, label: String(latest), isYear: true });

      for (const e of entries) {
        const pos = (maxM - e.month) / span;
        const key = `${e.year}-${String(e.month).padStart(2, "0")}`;
        datePositions.set(key, Math.max(0, Math.min(1, pos)));
        marks.push({
          position: pos,
          label: `${e.month}月`,
          isYear: false,
        });
      }
      return { marks, datePositions };
    }

    // ── Multi-year: non-linear year weights ─────────────────────
    let totalW = 0;
    const yearMeta = new Map<number, { start: number; w: number }>();
    for (const y of years) {
      const w = yearWeight(latest - y);
      yearMeta.set(y, { start: totalW, w });
      totalW += w;
    }

    // Year marks + month ticks
    for (const y of years) {
      const m = yearMeta.get(y)!;
      marks.push({
        position: m.start / totalW,
        label: String(y),
        isYear: true,
      });
      if (m.w >= 20) {
        for (let mo = 2; mo <= 12; mo++) {
          marks.push({
            position: (m.start + ((mo - 1) / 12) * m.w) / totalW,
            label: `${mo}月`,
            isYear: false,
          });
        }
      }
    }

    // Date positions for each entry
    for (const e of entries) {
      const m = yearMeta.get(e.year);
      if (!m) continue;
      const frac = ((e.month - 1) * 30.44) / 365.25;
      const pos = (m.start + (1 - frac) * m.w) / totalW;
      const key = `${e.year}-${String(e.month).padStart(2, "0")}`;
      datePositions.set(key, Math.max(0, Math.min(1, pos)));
    }

    return { marks, datePositions };
  }, [entries]);
}

// ── Format year-month for tooltip ───────────────────────────────
function formatTooltipYM(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${Number.parseInt(m, 10)}月`;
}

// ── Component ───────────────────────────────────────────────────
export function TimelineScrubber({
  libraryId,
  dateGroupRefs,
}: {
  libraryId: string;
  dateGroupRefs: Map<string, HTMLDivElement>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbPos, setThumbPos] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tooltip, setTooltip] = useState<{
    y: number;
    text: string;
  } | null>(null);
  const raf = useRef(0);

  const { data: timelineEntries } = api.mediaLibrary.getTimelineIndex.useQuery(
    { libraryId },
    { enabled: !!libraryId },
  );
  const { marks, datePositions } = useTimelineLayout(timelineEntries ?? []);

  // ── Scroll container ────────────────────────────────────────
  const scRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    scRef.current = document.getElementById("dashboard-scroll-container");
  }, []);

  // ── Scroll → thumb sync ─────────────────────────────────────
  useEffect(() => {
    const sc = scRef.current;
    if (!sc || datePositions.size === 0) return;

    const onScroll = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        if (dragging) return;
        const vpTop = sc.getBoundingClientRect().top + 80;
        let best: string | null = null;
        for (const [date, el] of dateGroupRefs) {
          if (el.getBoundingClientRect().top <= vpTop) best = date;
        }
        if (best != null) {
          const ym = best.slice(0, 7); // "2025-03" from "2025-03-12"
          if (datePositions.has(ym)) {
            setThumbPos(datePositions.get(ym)!);
          }
        }
      });
    };

    sc.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf.current);
    };
  }, [dateGroupRefs, datePositions, dragging]);

  // ── Position → nearest year-month ───────────────────────────
  const nearestDate = useCallback(
    (pos: number) => {
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
    [datePositions],
  );

  // ── Scroll to track Y coordinate ────────────────────────────
  const scrollToY = useCallback(
    (clientY: number) => {
      if (!trackRef.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
      const nearest = nearestDate(pos);
      if (nearest) {
        // Find first dateGroupRef that starts with this year-month
        for (const [date, el] of dateGroupRefs) {
          if (date.startsWith(nearest)) {
            el.scrollIntoView({
              behavior: dragging ? "auto" : "smooth",
              block: "start",
            });
            break;
          }
        }
        setTooltip({ y: clientY, text: formatTooltipYM(nearest) });
      }
      setThumbPos(pos);
    },
    [dateGroupRefs, nearestDate, dragging],
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
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, scrollToY]);

  // ── Hover tooltip ───────────────────────────────────────────
  const onHover = useCallback(
    (e: React.MouseEvent) => {
      if (dragging || !trackRef.current) return;
      const r = trackRef.current.getBoundingClientRect();
      const pos = (e.clientY - r.top) / r.height;
      const ym = nearestDate(pos);
      if (ym) {
        setTooltip({ y: e.clientY, text: formatTooltipYM(ym) });
      }
    },
    [dragging, nearestDate],
  );

  const onLeave = useCallback(() => {
    if (!dragging) setTooltip(null);
  }, [dragging]);

  if (datePositions.size === 0) return null;

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Timeline scrubber"
      aria-valuenow={Math.round(thumbPos * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-orientation="vertical"
      tabIndex={0}
      className="fixed right-0 z-30 hidden w-12 cursor-pointer select-none lg:block"
      style={{ top: "80px", bottom: "12px" }}
      onMouseDown={onDown}
      onMouseMove={onHover}
      onMouseLeave={onLeave}
    >
      {/* Vertical track line */}
      <div className="absolute left-5 top-0 bottom-0 w-px bg-neutral-400/20 dark:bg-neutral-500/20" />

      {/* Thumb indicator — rounded bar behind text */}
      <div
        className="absolute right-0 h-5 w-11 rounded-l-md bg-orange-500/15 dark:bg-orange-400/20"
        style={{
          top: `${thumbPos * 100}%`,
          transform: "translateY(-50%)",
          transition: dragging ? "none" : "top 150ms ease-out",
        }}
      />

      {/* Year / month marks (rendered after thumb so text is on top) */}
      {marks.map((m) =>
        m.isYear ? (
          <span
            key={`y-${m.label}`}
            className="absolute right-1 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500"
            style={{
              top: `${m.position * 100}%`,
              transform: "translateY(-50%)",
            }}
          >
            {m.label}
          </span>
        ) : (
          <div
            key={`m-${m.label}-${m.position.toFixed(4)}`}
            className="absolute left-4 h-px w-2 bg-neutral-400/25 dark:bg-neutral-500/25"
            style={{ top: `${m.position * 100}%` }}
          />
        ),
      )}

      {/* Tooltip (during hover/drag) */}
      {tooltip && (
        <div
          className="pointer-events-none fixed right-14 z-40 rounded-md bg-neutral-800/90 px-2 py-1 text-xs whitespace-nowrap text-white shadow-lg dark:bg-neutral-700/95"
          style={{ top: tooltip.y, transform: "translateY(-50%)" }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
