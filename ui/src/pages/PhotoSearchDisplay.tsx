import { Empty, Spin } from "@tokimo/ui";
import { ScanText, Sparkles, X } from "lucide-react";
import { thumbUrl } from "../lib/thumb";

// ── OCR search results banner ──────────────────────────────────────────

interface OcrSearchBannerProps {
  debouncedSearch: string;
  ocrResults: { photoId: string }[];
  ocrFilterActive: boolean;
  setOcrFilterActive: (v: boolean) => void;
  setOcrDismissed: (v: boolean) => void;
}

export function OcrSearchBanner({
  debouncedSearch,
  ocrResults,
  ocrFilterActive,
  setOcrFilterActive,
  setOcrDismissed,
}: OcrSearchBannerProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950/50">
      <ScanText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
      {ocrFilterActive ? (
        <span className="text-sm text-blue-700 dark:text-blue-300">
          正在显示 {ocrResults.length} 张 OCR 匹配照片（包含「
          {debouncedSearch}」的文字）
        </span>
      ) : (
        <button
          type="button"
          className="cursor-pointer text-sm text-blue-700 hover:underline dark:text-blue-300"
          onClick={() => setOcrFilterActive(true)}
        >
          还找到 {ocrResults.length} 张包含「{debouncedSearch}
          」文字的照片，点击查看
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">
        {ocrFilterActive && (
          <button
            type="button"
            className="cursor-pointer rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
            onClick={() => setOcrFilterActive(false)}
          >
            显示全部
          </button>
        )}
        <button
          type="button"
          className="cursor-pointer rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900 dark:hover:text-blue-300"
          onClick={() => {
            setOcrDismissed(true);
            setOcrFilterActive(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── CLIP visual search results grid ────────────────────────────────────

interface ClipResult {
  photoId: string;
  filename: string;
  similarity: number;
}

interface ClipSearchGridProps {
  isQueryLoaded: boolean;
  results: ClipResult[];
}

export function ClipSearchGrid({
  isQueryLoaded,
  results,
}: ClipSearchGridProps) {
  if (!isQueryLoaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (results.length === 0) {
    return <Empty description="未找到匹配的照片，试试换个描述" />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 px-1">
        <Sparkles className="h-4 w-4 text-purple-500" />
        <span className="text-sm text-fg-muted">
          找到 {results.length} 张相似照片
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {results.map((result) => (
          <div
            key={result.photoId}
            className="group relative aspect-square overflow-hidden rounded-lg bg-fill-tertiary"
          >
            <img
              src={thumbUrl("photo", result.photoId, 160)}
              alt={result.filename}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute top-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
              {Math.round(result.similarity * 100)}%
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="truncate text-xs text-white">
                {result.filename}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
