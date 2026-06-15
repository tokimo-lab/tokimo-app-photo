import type { EmojiMartData } from "@emoji-mart/data";
import _data from "@emoji-mart/data";
import { cn, Input, ScrollArea } from "@tokimo/ui";
import { Search } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";

const data = _data as unknown as EmojiMartData;

interface EmojiGridProps {
  selected: string;
  onSelect: (emoji: string) => void;
}

interface EmojiEntry {
  id: string;
  native: string;
  name: string;
  keywords: string[];
}

const CATEGORY_META: { id: string; icon: string; label: string }[] = [
  { id: "people", icon: "😀", label: "表情" },
  { id: "nature", icon: "🐻", label: "自然" },
  { id: "foods", icon: "🍔", label: "食物" },
  { id: "activity", icon: "⚽", label: "活动" },
  { id: "places", icon: "✈️", label: "旅行" },
  { id: "objects", icon: "💡", label: "物品" },
  { id: "symbols", icon: "💟", label: "符号" },
  { id: "flags", icon: "🏁", label: "旗帜" },
];

/** Pre-compute all emojis grouped by category */
const ALL_CATEGORIES = data.categories.map((cat) => ({
  id: cat.id,
  emojis: cat.emojis
    .map((id) => {
      const e = data.emojis[id];
      if (!e) return null;
      return {
        id,
        native: e.skins[0].native,
        name: e.name.toLowerCase(),
        keywords: e.keywords ?? [],
      };
    })
    .filter(Boolean) as EmojiEntry[],
}));

/** Flat list of every emoji (for "all" mode) */
const ALL_EMOJIS = ALL_CATEGORIES.flatMap((c) => c.emojis);

const COLS = 9;
const ROW_H = 40; // h-9 (36px) + gap (4px)

export function EmojiGrid({ selected, onSelect }: EmojiGridProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const listRef = useRef(null);

  const emojis = useMemo(() => {
    // Search always spans all categories
    if (deferredQuery) {
      return ALL_EMOJIS.filter(
        (e) =>
          e.name.includes(deferredQuery) ||
          e.id.includes(deferredQuery) ||
          e.keywords.some((kw) => kw.includes(deferredQuery)),
      );
    }
    if (activeCategory) {
      return (
        ALL_CATEGORIES.find((c) => c.id === activeCategory)?.emojis ??
        ALL_EMOJIS
      );
    }
    return ALL_EMOJIS;
  }, [activeCategory, deferredQuery]);

  const rowCount = Math.ceil(emojis.length / COLS);

  const renderRow = useCallback(
    (rowIndex: number) => {
      const start = rowIndex * COLS;
      const rowItems = emojis.slice(start, start + COLS);
      return (
        <div className="grid grid-cols-9 gap-1 px-1">
          {rowItems.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cn(
                "flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-lg transition-all",
                selected === entry.native
                  ? "scale-110 bg-blue-500/20 shadow-md ring-1 ring-blue-500"
                  : "hover:bg-fill-tertiary",
              )}
              onClick={() => onSelect(entry.native)}
              title={entry.name}
            >
              {entry.native}
            </button>
          ))}
        </div>
      );
    },
    [emojis, selected, onSelect],
  );

  const handleCategoryClick = useCallback((id: string) => {
    setActiveCategory((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Input
        className="w-full"
        placeholder="搜索表情..."
        size="small"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        prefix={<Search className="h-3.5 w-3.5 text-fg-muted" />}
        allowClear
      />

      {/* Horizontal category bar */}
      <ScrollArea direction="horizontal" className="h-8" hideScrollbar>
        <div className="flex gap-1">
          {CATEGORY_META.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
                activeCategory === cat.id
                  ? "bg-fill-secondary text-fg-primary"
                  : "text-fg-muted hover:bg-fill-tertiary",
              )}
              onClick={() => handleCategoryClick(cat.id)}
            >
              <span>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* Emoji grid */}
      {emojis.length === 0 ? (
        <div className="py-6 text-center text-sm text-fg-muted">
          未找到匹配的表情
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
