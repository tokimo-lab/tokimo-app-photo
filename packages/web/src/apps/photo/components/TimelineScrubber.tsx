import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/generated/rust-api";

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
// Splits years into 3 tiers by distance from latest, each tier
// occupies exactly 1/3 of the track:
//   Tier 1 (day precision):   top 1/3 — closest years
//   Tier 2 (month precision): middle 1/3
//   Tier 3 (year only):       bottom 1/3 — distant years

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
interface LayoutResult {
  marks: Mark[];
  datePositions: Map<string, number>;
  posToDateLabel: (pos: number) => string;
}

function useTimelineLayout(
  entries: TimelineEntry[],
  focusYear: number | null,
): LayoutResult {
  return useMemo(() => {
    const empty: LayoutResult = {
      marks: [],
      datePositions: new Map(),
      posToDateLabel: () => "",
    };
    if (entries.length === 0) return empty;

    const years = [...new Set(entries.map((e) => e.year))].sort(
      (a, b) => b - a,
    );
    const focus = focusYear ?? years[0];
    const marks: Mark[] = [];
    const datePositions = new Map<string, number>();

    // ── Single year: linear by month ────────────────────────────
    if (years.length === 1) {
      const months = entries.map((e) => e.month).sort((a, b) => b - a);
      const maxM = Math.max(...months);
      const minM = Math.min(...months);
      const span = maxM - minM || 1;

      marks.push({ position: 0, label: String(years[0]), isYear: true });

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
      const yr = years[0];
      return {
        marks,
        datePositions,
        posToDateLabel: (pos: number) => {
          const mo = Math.round(maxM - pos * span);
          return `${yr}年${Math.max(1, Math.min(12, mo))}月`;
        },
      };
    }

    // ── Multi-year: 3-tier weight centered on focus year ────────
    // Day tier:   focus year (±0) → 1/3 of track, month labels + day ticks
    // Month tier: focus ±1–2 years → 1/3 of track, year labels only
    // Year tier:  everything else → 1/3 of track, year labels only
    // On drag-end, focus shifts → layout recomputes → second drag is precise

    // Build month set per year
    const yearMonths = new Map<number, number[]>();
    for (const e of entries) {
      let arr = yearMonths.get(e.year);
      if (!arr) {
        arr = [];
        yearMonths.set(e.year, arr);
      }
      arr.push(e.month);
    }

    // Split into 3 tiers by distance from focus
    const dayYears: number[] = [];
    const monthYears: number[] = [];
    const yearOnlyYears: number[] = [];
    for (const y of years) {
      const d = Math.abs(focus - y);
      if (d === 0) dayYears.push(y);
      else if (d <= 2) monthYears.push(y);
      else yearOnlyYears.push(y);
    }

    // Day tier gets half the weight so recent months don't stretch too far
    const DAY_TIER_W = 50;
    const TIER_W = 100;
    const tierAssign = (tier: number[], tw = TIER_W) => {
      const wm = new Map<number, number>();
      if (tier.length === 0) return wm;
      const n = tier.length;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const s = 1.3 - 0.6 * t;
        wm.set(tier[i], s);
        sum += s;
      }
      for (const [y, w] of wm) wm.set(y, (w / sum) * tw);
      return wm;
    };
    const dayW = tierAssign(dayYears, DAY_TIER_W);
    const monthW = tierAssign(monthYears);
    const yearW = tierAssign(yearOnlyYears);

    // Build yearMeta — NO coverage scaling (each tier keeps its 1/3)
    let totalW = 0;
    const yearMeta = new Map<number, { start: number; w: number }>();
    for (const y of years) {
      const w = dayW.get(y) ?? monthW.get(y) ?? yearW.get(y) ?? 1;
      yearMeta.set(y, { start: totalW, w });
      totalW += w;
    }

    // Tier sets for mark generation
    const daySet = new Set(dayYears);
    const monthSet = new Set(monthYears);

    // Estimate track pixel height for label density calculation
    const TRACK_PX = 700;
    const LABEL_H = 16; // min px between month labels

    for (const y of years) {
      const m = yearMeta.get(y)!;
      const months = yearMonths.get(y) ?? [];
      const maxMo = Math.max(...months, 1);
      const minMo = Math.min(...months, 12);
      const moRange = maxMo - minMo + 1;

      marks.push({
        position: m.start / totalW,
        label: String(y),
        isYear: true,
      });

      if (daySet.has(y)) {
        // Day tier: month labels + day ticks
        for (let mo = maxMo; mo >= minMo; mo--) {
          const moPos = (maxMo - mo) / moRange;
          if (mo < maxMo) {
            marks.push({
              position: (m.start + moPos * m.w) / totalW,
              label: `${mo + 1}月`,
              isYear: false,
            });
          }
          for (const day of [10, 20]) {
            const dayPos = (maxMo - mo + (day - 1) / 30) / moRange;
            marks.push({
              position: (m.start + dayPos * m.w) / totalW,
              label: "",
              isYear: false,
            });
          }
        }
      } else if (monthSet.has(y)) {
        // Month tier: show month labels at adaptive density
        const yearPx = (m.w / totalW) * TRACK_PX;
        const maxLabels = Math.max(1, Math.floor(yearPx / LABEL_H));
        const step = Math.max(1, Math.ceil(moRange / maxLabels));
        for (let mo = maxMo - step; mo >= minMo; mo -= step) {
          const moPos = (maxMo - mo) / moRange;
          marks.push({
            position: (m.start + moPos * m.w) / totalW,
            label: `${mo + 1}月`,
            isYear: false,
          });
        }
      }
      // Year tier: year label only
    }

    // Date positions for each entry (using clipped month range)
    for (const e of entries) {
      const m = yearMeta.get(e.year);
      if (!m) continue;
      const months = yearMonths.get(e.year) ?? [];
      const maxMo = Math.max(...months, 1);
      const minMo = Math.min(...months, 12);
      const moRange = maxMo - minMo + 1;
      const pos = (m.start + ((maxMo - e.month) / moRange) * m.w) / totalW;
      const key = `${e.year}-${String(e.month).padStart(2, "0")}`;
      datePositions.set(key, Math.max(0, Math.min(1, pos)));
    }

    // Capture for posToDateLabel closure
    const _yearMeta = yearMeta;
    const _totalW = totalW;
    const _years = years;
    const _yearMonths = yearMonths;

    return {
      marks,
      datePositions,
      posToDateLabel: (pos: number) => {
        const absW = pos * _totalW;
        for (let i = 0; i < _years.length; i++) {
          const y = _years[i];
          const meta = _yearMeta.get(y)!;
          const nextStart = meta.start + meta.w;
          if (absW <= nextStart || i === _years.length - 1) {
            const months = _yearMonths.get(y) ?? [];
            const maxMo = Math.max(...months, 1);
            const minMo = Math.min(...months, 12);
            const within = (absW - meta.start) / meta.w; // 0=top(maxMo) 1=bottom(minMo)
            const moRange = maxMo - minMo + 1;
            const moFloat = maxMo - within * moRange;
            const mo = Math.max(minMo, Math.min(maxMo, Math.floor(moFloat)));
            const dayFrac = moFloat - mo;
            const d = Math.max(1, Math.min(31, Math.floor(dayFrac * 30) + 1));
            return `${y}年${mo}月${d}日`;
          }
        }
        return "";
      },
    };
  }, [entries, focusYear]);
}

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
  const [thumbPos, setThumbPos] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [focusYear, setFocusYear] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{
    y: number;
    text: string;
  } | null>(null);

  const { data: timelineEntries } = api.app.getTimelineIndex.useQuery(
    { appId },
    { enabled: !!appId },
  );
  const { marks, datePositions, posToDateLabel } = useTimelineLayout(
    timelineEntries ?? [],
    focusYear,
  );

  // ── Scroll → thumb sync (driven by virtualizer's visible date) ──
  useEffect(() => {
    if (dragging || !currentVisibleDate || datePositions.size === 0) return;
    const ym = currentVisibleDate.slice(0, 7); // "2025-03" from "2025-03-12"
    if (datePositions.has(ym)) {
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
        scrollToDate(nearest, !dragging);
        setTooltip({ y: clientY, text: posToDateLabel(pos) });
      }
      setThumbPos(pos);
    },
    [nearestDate, dragging, posToDateLabel, scrollToDate],
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
        setTooltip({ y: e.clientY, text: label });
      }
    },
    [dragging, posToDateLabel],
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
