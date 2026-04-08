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

    // Only 1 day bucket — nothing to scrub through
    if (entries.length === 1) return empty;

    const years = [...new Set(entries.map((e) => e.year))].sort(
      (a, b) => b - a,
    );
    const focus = focusYear ?? years[0];
    const marks: Mark[] = [];
    const datePositions = new Map<string, number>();

    // ── Single month: linear by day ─────────────────────────────
    const uniqueYearMonths = [
      ...new Set(entries.map((e) => `${e.year}-${e.month}`)),
    ];
    if (uniqueYearMonths.length === 1) {
      const year = entries[0].year;
      const month = entries[0].month;
      const days = entries.map((e) => e.day).sort((a, b) => b - a);
      const maxD = Math.max(...days);
      const minD = Math.min(...days);
      const span = maxD - minD || 1;

      // Year+month label at top
      marks.push({ position: 0, label: `${year}/${month}`, isYear: true });

      for (const e of entries) {
        const pos = (maxD - e.day) / span;
        const key = `${e.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
        datePositions.set(key, Math.max(0, Math.min(1, pos)));
        marks.push({ position: pos, label: `${e.day}日`, isYear: false });
      }

      return {
        marks,
        datePositions,
        posToDateLabel: (pos: number) => {
          const dayFloat = maxD - pos * span;
          const d = Math.max(minD, Math.min(maxD, Math.round(dayFloat)));
          return `${year}年${month}月${d}日`;
        },
      };
    }

    // ── Single year: linear by month, no year label ─────────────
    if (years.length === 1) {
      const months = [...new Set(entries.map((e) => e.month))].sort(
        (a, b) => b - a,
      );
      const maxM = Math.max(...months);
      const minM = Math.min(...months);
      const span = maxM - minM || 1;

      for (const mo of months) {
        const pos = (maxM - mo) / span;
        // Use first day of each month as the key
        const key = `${years[0]}-${String(mo).padStart(2, "0")}-01`;
        datePositions.set(key, Math.max(0, Math.min(1, pos)));
        marks.push({
          position: pos,
          label: `${mo}月`,
          isYear: false,
        });
      }
      return {
        marks,
        datePositions,
        posToDateLabel: (pos: number) => {
          const mo = Math.round(maxM - pos * span);
          return `${years[0]}年${Math.max(1, Math.min(12, mo))}月1日`;
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
      if (!arr.includes(e.month)) arr.push(e.month);
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
      const key = `${e.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
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
