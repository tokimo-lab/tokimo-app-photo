import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Right-side year/month navigator for photo timeline.
 * Shows year labels with dot indicators, highlights the currently visible year.
 * Clicking scrolls to the first date group of that year.
 */
export function YearNavigator({
  years,
  dateGroupRefs,
}: {
  years: number[];
  dateGroupRefs: Map<string, HTMLDivElement>;
}) {
  const [activeYear, setActiveYear] = useState<number>(years[0] ?? 0);
  const rafRef = useRef(0);

  // Track which year group is currently in viewport
  useEffect(() => {
    if (years.length === 0) return;

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const viewTop = window.scrollY + 120;
        let best: number | null = null;
        for (const [date, el] of dateGroupRefs) {
          if (el.offsetTop <= viewTop + 40) {
            const y = Number.parseInt(date.slice(0, 4), 10);
            if (y > 0) best = y;
          }
        }
        if (best !== null && best !== activeYear) {
          setActiveYear(best);
        }
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [years, dateGroupRefs, activeYear]);

  const scrollToYear = useCallback(
    (year: number) => {
      // Find the first date group of this year
      for (const [date, el] of dateGroupRefs) {
        if (date.startsWith(String(year))) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          break;
        }
      }
    },
    [dateGroupRefs],
  );

  if (years.length <= 1) return null;

  return (
    <div className="fixed right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1">
      {years.map((year) => (
        <button
          key={year}
          type="button"
          className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-all ${
            year === activeYear
              ? "bg-orange-500 text-white shadow-sm"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
          onClick={() => scrollToYear(year)}
          title={String(year)}
        >
          {year}
        </button>
      ))}
      {/* Vertical dots between years */}
      <div className="my-0.5 flex flex-col gap-0.5">
        {["dot-a", "dot-b", "dot-c"]
          .slice(0, Math.min(3, years.length))
          .map((dotId) => (
            <div
              key={dotId}
              className="mx-auto h-0.5 w-0.5 rounded-full bg-neutral-600"
            />
          ))}
      </div>
    </div>
  );
}
