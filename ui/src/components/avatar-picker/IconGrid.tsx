import { cn, Input, ScrollArea } from "@tokimo/ui";
import { icons, type LucideIcon, Search } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { ICON_CATALOG, pascalToKebab } from "../../lib/icon-catalog";

interface IconGridProps {
  selected: string;
  onSelect: (name: string) => void;
}

interface IconEntry {
  name: string;
  component: LucideIcon;
  keywords: string[];
}

const COLS = 9;
const ROW_H = 40; // h-9 (36px) + gap (4px)

/** Build keyword lookup from the curated catalog */
const KEYWORD_MAP = new Map(ICON_CATALOG.map((e) => [e.name, e.keywords]));

/** Full icon list from lucide-react, merged with curated keywords */
const ALL_ICONS: IconEntry[] = Object.entries(icons)
  .filter(([name]) => {
    // Skip internal/utility icons
    const lower = name.toLowerCase();
    return !lower.startsWith("lucide") && !lower.endsWith("icon");
  })
  .map(([pascal, component]) => {
    const kebab = pascalToKebab(pascal);
    return {
      name: kebab,
      component,
      keywords: KEYWORD_MAP.get(kebab) ?? [],
    };
  })
  .sort((a, b) => {
    // Curated icons first, then alphabetical
    const aHas = KEYWORD_MAP.has(a.name) ? 0 : 1;
    const bHas = KEYWORD_MAP.has(b.name) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    return a.name.localeCompare(b.name);
  });

export function IconGrid({ selected, onSelect }: IconGridProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    if (!deferredQuery) return ALL_ICONS;
    return ALL_ICONS.filter(
      (e) =>
        e.name.includes(deferredQuery) ||
        e.keywords.some((kw) => kw.toLowerCase().includes(deferredQuery)),
    );
  }, [deferredQuery]);

  const rowCount = Math.ceil(filtered.length / COLS);

  const renderRow = useCallback(
    (rowIndex: number) => {
      const start = rowIndex * COLS;
      const rowItems = filtered.slice(start, start + COLS);
      return (
        <div className="grid grid-cols-9 gap-1 px-1">
          {rowItems.map((entry) => {
            const Icon = entry.component;
            const isSelected = selected === `lucide:${entry.name}`;
            return (
              <button
                key={entry.name}
                type="button"
                className={cn(
                  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all",
                  isSelected
                    ? "scale-110 bg-blue-500 text-white shadow-md"
                    : "text-fg-muted hover:bg-fill-tertiary",
                )}
                onClick={() => onSelect(entry.name)}
                title={entry.name}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            );
          })}
        </div>
      );
    },
    [filtered, selected, onSelect],
  );

  return (
    <div className="flex flex-col gap-2">
      <Input
        className="w-full"
        placeholder="搜索图标..."
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        prefix={<Search className="h-3.5 w-3.5 text-fg-muted" />}
        allowClear
      />
      {filtered.length === 0 ? (
        <div className="py-6 text-center text-sm text-fg-muted">
          未找到匹配的图标
        </div>
      ) : (
        <ScrollArea
          ref={listRef}
          className="h-[220px]"
          itemCount={rowCount}
          itemHeight={ROW_H}
          renderItem={renderRow}
          direction="vertical"
        />
      )}
    </div>
  );
}
