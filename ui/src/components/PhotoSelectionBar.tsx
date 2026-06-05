import { Button } from "@tokimo/ui";
import { EyeOff, Heart, HeartOff, ImagePlus, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";

export function PhotoSelectionBar({
  count,
  container,
  onAddToAlbum,
  onBatchFavorite,
  onBatchUnfavorite,
  onBatchHide,
  onTrash,
  onClear,
}: {
  count: number;
  container?: HTMLElement | null;
  onAddToAlbum: () => void;
  onBatchFavorite: () => void;
  onBatchUnfavorite: () => void;
  onBatchHide: () => void;
  onTrash: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  const bar = (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border-base bg-surface-overlay px-5 py-3 shadow-2xl backdrop-blur-lg">
        <span className="text-sm font-medium text-fg-secondary">
          已选择 <strong className="text-orange-500">{count}</strong> 张
        </span>

        <div className="mx-1 h-5 w-px bg-fill-tertiary" />

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
        <Button onClick={onBatchHide} icon={<EyeOff className="h-4 w-4" />}>
          隐藏
        </Button>
        <Button
          onClick={onTrash}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-red-500 hover:text-red-600 dark:text-red-400"
        >
          删除
        </Button>

        <div className="mx-1 h-5 w-px bg-fill-tertiary" />

        <button
          type="button"
          className="cursor-pointer rounded-full p-1.5 text-fg-muted transition-colors hover:bg-fill-tertiary hover:text-fg-secondary"
          onClick={onClear}
          title="取消选择"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return container ? createPortal(bar, container) : bar;
}
