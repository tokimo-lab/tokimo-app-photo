import { useMemo } from "react";

interface Mark {
  position: number; // 0–1 from top
  label: string;
  isYear: boolean;
}

interface TimelineEntry {
  year: number;
  month: number;
  day: number;
  count: number;
}

export interface LayoutResult {
  marks: Mark[];
  datePositions: Map<string, number>;
  posToDateLabel: (pos: number) => string;
}

/** Ordinal-ish integer for a date, used only for interval math. */
function dateOrdinal(y: number, m: number, d: number): number {
  return y * 400 + m * 32 + d;
}

/** Nearest-entry lookup from a sorted list with precomputed positions. */
function makeNearestLookup(
  entriesWithPos: Array<TimelineEntry & { pos: number }>,
) {
  return (pos: number): string => {
    if (entriesWithPos.length === 0) return "";
    let best = entriesWithPos[0];
    let bd = Math.abs(best.pos - pos);
    for (let i = 1; i < entriesWithPos.length; i++) {
      const e = entriesWithPos[i];
      const d = Math.abs(e.pos - pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return `${best.year}年${best.month}月${best.day}日`;
  };
}

/** Day-precise linear layout with month-level aggregated labels.
 *  Used for single-year and single-month cases (any short-span timeline). */
function buildDayPreciseLayout(
  entries: TimelineEntry[],
  includeYearInLabel: boolean,
): LayoutResult {
  // Sort DESC (newest at pos 0)
  const sorted = [...entries].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.month !== b.month) return b.month - a.month;
    return b.day - a.day;
  });

  const maxOrd = dateOrdinal(sorted[0].year, sorted[0].month, sorted[0].day);
  const last = sorted[sorted.length - 1];
  const minOrd = dateOrdinal(last.year, last.month, last.day);
  const span = maxOrd - minOrd || 1;

  const entriesWithPos = sorted.map((e) => ({
    ...e,
    pos: Math.max(
      0,
      Math.min(1, (maxOrd - dateOrdinal(e.year, e.month, e.day)) / span),
    ),
  }));

  const datePositions = new Map<string, number>();
  for (const e of entriesWithPos) {
    const key = `${e.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
    datePositions.set(key, e.pos);
  }

  // Display labels: one per (year, month), positioned at the first (newest) entry of that ym
  const seenYM = new Set<string>();
  const marks: Mark[] = [];
  for (const e of entriesWithPos) {
    const ymKey = `${e.year}-${e.month}`;
    if (seenYM.has(ymKey)) continue;
    seenYM.add(ymKey);
    marks.push({
      position: e.pos,
      label: includeYearInLabel ? `${e.year}/${e.month}` : `${e.month}月`,
      isYear: false,
    });
  }

  return {
    marks,
    datePositions,
    posToDateLabel: makeNearestLookup(entriesWithPos),
  };
}

export function useTimelineLayout(
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
    if (entries.length === 1) return empty;

    const years = [...new Set(entries.map((e) => e.year))].sort(
      (a, b) => b - a,
    );
    const focus = focusYear ?? years[0];

    // ── Single month: day-precise linear ────────────────────────
    const uniqueYearMonths = [
      ...new Set(entries.map((e) => `${e.year}-${e.month}`)),
    ];
    if (uniqueYearMonths.length === 1) {
      const layout = buildDayPreciseLayout(entries, true);
      // Prepend a year-month header label at top (pos 0)
      const year = entries[0].year;
      const month = entries[0].month;
      layout.marks.unshift({
        position: 0,
        label: `${year}/${month}`,
        isYear: true,
      });
      return layout;
    }

    // ── Single year: day-precise linear, month labels only ──────
    if (years.length === 1) {
      return buildDayPreciseLayout(entries, false);
    }

    // ── Multi-year: 3-tier weight centered on focus year ────────
    // Day tier:   focus year (±0) → compact slice, day-precise positioning
    // Month tier: focus ±1–2 years → month-level positioning
    // Year tier:  everything else → year-level only
    const marks: Mark[] = [];
    const datePositions = new Map<string, number>();

    // Build month set per year (for tier-internal month range)
    const yearMonths = new Map<number, number[]>();
    for (const e of entries) {
      let arr = yearMonths.get(e.year);
      if (!arr) {
        arr = [];
        yearMonths.set(e.year, arr);
      }
      if (!arr.includes(e.month)) arr.push(e.month);
    }

    // Partition entries per year for nearest-day lookup in day tier
    const yearEntries = new Map<number, TimelineEntry[]>();
    for (const e of entries) {
      let arr = yearEntries.get(e.year);
      if (!arr) {
        arr = [];
        yearEntries.set(e.year, arr);
      }
      arr.push(e);
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

    let totalW = 0;
    const yearMeta = new Map<number, { start: number; w: number }>();
    for (const y of years) {
      const w = dayW.get(y) ?? monthW.get(y) ?? yearW.get(y) ?? 1;
      yearMeta.set(y, { start: totalW, w });
      totalW += w;
    }

    const daySet = new Set(dayYears);
    const monthSet = new Set(monthYears);

    const TRACK_PX = 700;
    const LABEL_H = 16;

    // Sorted entries-with-pos in day tier (for nearest lookup)
    const dayTierEntries: Array<TimelineEntry & { pos: number }> = [];

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
        // Day tier: month labels + day-precise entry positioning
        const yEntries = yearEntries.get(y) ?? [];
        // Compute ordinal span within this year tier (by day)
        const sorted = [...yEntries].sort((a, b) => {
          if (a.month !== b.month) return b.month - a.month;
          return b.day - a.day;
        });
        const maxOrdY = dateOrdinal(
          y,
          sorted[0]?.month ?? maxMo,
          sorted[0]?.day ?? 31,
        );
        const last = sorted[sorted.length - 1];
        const minOrdY = dateOrdinal(y, last?.month ?? minMo, last?.day ?? 1);
        const spanY = maxOrdY - minOrdY || 1;

        // Month labels only — placed at first entry of each month
        const seenYM = new Set<number>();
        for (const e of sorted) {
          if (seenYM.has(e.month)) continue;
          seenYM.add(e.month);
          const moPos = (maxOrdY - dateOrdinal(y, e.month, e.day)) / spanY;
          marks.push({
            position: (m.start + moPos * m.w) / totalW,
            label: `${e.month}月`,
            isYear: false,
          });
        }

        for (const e of sorted) {
          const moPos = (maxOrdY - dateOrdinal(y, e.month, e.day)) / spanY;
          const pos = (m.start + moPos * m.w) / totalW;
          const key = `${y}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
          datePositions.set(key, Math.max(0, Math.min(1, pos)));
          dayTierEntries.push({ ...e, pos });
        }
      } else if (monthSet.has(y)) {
        // Month tier: month labels at adaptive density
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
        // Month-level date positions
        for (const e of yearEntries.get(y) ?? []) {
          const moPos = (maxMo - e.month) / moRange;
          const pos = (m.start + moPos * m.w) / totalW;
          const key = `${y}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
          datePositions.set(key, Math.max(0, Math.min(1, pos)));
        }
      } else {
        // Year tier: year-only positioning
        for (const e of yearEntries.get(y) ?? []) {
          const pos = m.start / totalW;
          const key = `${y}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
          datePositions.set(key, pos);
        }
      }
    }

    // posToDateLabel: use day-tier nearest lookup when pos lands in a day-tier year,
    // else fall back to month/year approximation.
    const _yearMeta = yearMeta;
    const _totalW = totalW;
    const _years = years;
    const _yearMonths = yearMonths;
    const dayNearestLookup = makeNearestLookup(dayTierEntries);

    return {
      marks,
      datePositions,
      posToDateLabel: (pos: number) => {
        // Detect day-tier range
        for (const y of dayYears) {
          const meta = _yearMeta.get(y)!;
          const top = meta.start / _totalW;
          const bottom = (meta.start + meta.w) / _totalW;
          if (pos >= top && pos <= bottom) {
            return dayNearestLookup(pos);
          }
        }
        // Non-day-tier: month/year approximation (legacy behavior)
        const absW = pos * _totalW;
        for (let i = 0; i < _years.length; i++) {
          const y = _years[i];
          const meta = _yearMeta.get(y)!;
          const nextStart = meta.start + meta.w;
          if (absW <= nextStart || i === _years.length - 1) {
            const months = _yearMonths.get(y) ?? [];
            const maxMo = Math.max(...months, 1);
            const minMo = Math.min(...months, 12);
            const within = (absW - meta.start) / meta.w;
            const moRange = maxMo - minMo + 1;
            const moFloat = maxMo - within * moRange;
            const mo = Math.max(minMo, Math.min(maxMo, Math.floor(moFloat)));
            return `${y}年${mo}月`;
          }
        }
        return "";
      },
    };
  }, [entries, focusYear]);
}
