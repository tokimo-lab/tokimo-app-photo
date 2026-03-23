import { Button } from "@tokiomo/components";
import { Heart, HeartOff, ImagePlus, X } from "lucide-react";

export function PhotoSelectionBar({
  count,
  onAddToAlbum,
  onBatchFavorite,
  onBatchUnfavorite,
  onClear,
}: {
  count: number;
  onAddToAlbum: () => void;
  onBatchFavorite: () => void;
  onBatchUnfavorite: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/90 px-5 py-3 shadow-2xl backdrop-blur-lg dark:bg-neutral-900/90">
      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
        已选择 <strong className="text-orange-500">{count}</strong> 张
      </span>

      <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

      <Button onClick={onAddToAlbum} icon={<ImagePlus className="h-4 w-4" />}>
        添加到相册
      </Button>
      <Button onClick={onBatchFavorite} icon={<Heart className="h-4 w-4" />}>
        收藏
      </Button>
      <Button
        onClick={onBatchUnfavorite}
        icon={<HeartOff className="h-4 w-4" />}
      >
        取消收藏
      </Button>

      <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />

      <button
        type="button"
        className="cursor-pointer rounded-full p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        onClick={onClear}
        title="取消选择"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
