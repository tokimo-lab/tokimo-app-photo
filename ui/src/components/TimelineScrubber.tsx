import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateGroup } from "./photo-utils";

/**
 * Non-linear timeline scrubber for photo timeline.
 *
 * Right-edge vertical track with year labels spaced non-linearly:
 * recent years spread out (month-level ticks), distant years compress,
 * very old years plateau at minimum spacing — matching MT Photos UX.
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

// ── Compute timeline layout ─────────────────────────────────────
function useTimelineLayout(groups: DateGroup[]) {
  return useMemo(() => {
    const valid = groups.filter((g) => g.year > 0);
    if (valid.length === 0)
      return { marks: [] as Mark[], datePositions: new Map<string, number>() };

    const years = [...new Set(valid.map((g) => g.year))].sort((a, b) => b - a);
    const latest = years[0];
    const datePositions = new Map<string, number>();
    const marks: Mark[] = [];

    // ── Single year: linear by date range ───────────────────────
    if (years.length === 1) {
      const times = valid.map((g) => new Date(g.date).getTime());
      const maxT = Math.max(...times);
      const minT = Math.min(...times);
      const span = maxT - minT || 1;

      for (const g of valid) {
        const t = new Date(g.date).getTime();
        datePositions.set(g.date, (maxT - t) / span);
      }

      marks.push({ position: 0, label: String(latest), isYear: true });

      // Show month labels when data spans multiple months
      const months = new Set(valid.map((g) => g.date.slice(0, 7)));
      if (months.size > 1) {
        for (const ym of months) {
          const d = new Date(`${ym}-01`);
          const t = d.getTime();
          if (t >= minT && t <= maxT) {
            marks.push({
              position: Math.max(0, Math.min(1, (maxT - t) / span)),
              label: `${d.getMonth() + 1}月`,
              isYear: false,
            });
          }
        }
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

    // Date group positions within their year segment
    for (const g of valid) {
      const m = yearMeta.get(g.year);
      if (!m) continue;
      const month = Number.parseInt(g.date.slice(5, 7), 10) || 1;
      const day = Number.parseInt(g.date.slice(8, 10), 10) || 1;
      const frac = ((month - 1) * 30.44 + day) / 365.25;
      // Within year: Dec at top (pos ≈ start), Jan at bottom (pos ≈ start+w)
      const pos = (m.start + (1 - frac) * m.w) / totalW;
      datePositions.set(g.date, Math.max(0, Math.min(1, pos)));
    }

    return { marks, datePositions };
  }, [groups]);
}

// ── Format date for tooltip ─────────────────────────────────────
function formatTooltipDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// ── Component ───────────────────────────────────────────────────
export function TimelineScrubber({
  groups,
  dateGroupRefs,
}: {
  groups: DateGroup[];
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
  const { marks, datePositions } = useTimelineLayout(groups);

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
        if (best != null && datePositions.has(best)) {
          setThumbPos(datePositions.get(best)!);
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

  // ── Position → nearest date ─────────────────────────────────
  const nearestDate = useCallback(
    (pos: number) => {
      let best: string | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const [date, dp] of datePositions) {
        const d = Math.abs(dp - pos);
        if (d < bestDist) {
          bestDist = d;
          best = date;
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
      const date = nearestDate(pos);
      if (date) {
        const el = dateGroupRefs.get(date);
        el?.scrollIntoView({
          behavior: dragging ? "auto" : "smooth",
          block: "start",
        });
        setTooltip({ y: clientY, text: formatTooltipDate(date) });
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
      const date = nearestDate(pos);
      if (date) {
        setTooltip({ y: e.clientY, text: formatTooltipDate(date) });
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

      {/* Year / month marks */}
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

      {/* Thumb indicator */}
      <div
        className="absolute left-[18px] h-1.5 w-1.5 rounded-full bg-orange-500 shadow-sm"
        style={{
          top: `${thumbPos * 100}%`,
          transform: "translate(-50%, -50%)",
          transition: dragging ? "none" : "top 150ms ease-out",
        }}
      />

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
