import {
  ChevronLeft,
  ChevronRight,
  Heart,
  Info,
  Maximize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type React from "react";

interface ViewerToolbarProps {
  hasPrev: boolean;
  hasNext: boolean;
  onNavigate: (dir: -1 | 1) => void;
  scale: number;
  setScale: (fn: (s: number) => number) => void;
  maxScale: number;
  onResetZoom: () => void;
  isFavorite: boolean;
  onFavorite: () => void;
  showInfo: boolean;
  onToggleInfo: () => void;
  onFullscreen: () => void;
}

export function ViewerToolbar({
  hasPrev,
  hasNext,
  onNavigate,
  scale,
  setScale,
  maxScale,
  onResetZoom,
  isFavorite,
  onFavorite,
  showInfo,
  onToggleInfo,
  onFullscreen,
}: ViewerToolbarProps) {
  const scalePercent = Math.round(scale * 100);

  return (
    <div
      className={`absolute bottom-0 left-0 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 py-2.5 transition-[right] duration-200 ${showInfo ? "right-80" : "right-0"}`}
    >
      <div className="flex items-center gap-1">
        <ToolBtn
          onClick={() => onNavigate(-1)}
          disabled={!hasPrev}
          title="上一张 (←)"
        >
          <ChevronLeft size={16} />
        </ToolBtn>
        <ToolBtn
          onClick={() => onNavigate(1)}
          disabled={!hasNext}
          title="下一张 (→)"
        >
          <ChevronRight size={16} />
        </ToolBtn>
      </div>

      <div className="flex items-center gap-1">
        <ToolBtn
          onClick={() => setScale((s) => Math.max(1, s / 1.3))}
          title="缩小"
        >
          <ZoomOut size={14} />
        </ToolBtn>
        <button
          type="button"
          onClick={onResetZoom}
          className="min-w-[48px] cursor-pointer rounded px-1.5 py-1 text-center text-[11px] text-white/60 hover:bg-white/15 hover:text-white/90 active:bg-white/25 transition-colors"
          title="重置缩放 (0)"
        >
          {scalePercent}%
        </button>
        <ToolBtn
          onClick={() => setScale((s) => Math.min(maxScale, s * 1.3))}
          title="放大"
        >
          <ZoomIn size={14} />
        </ToolBtn>
        <ToolBtn onClick={onResetZoom} title="重置 (0)">
          <RotateCcw size={13} />
        </ToolBtn>
      </div>

      <div className="flex items-center gap-1">
        <ToolBtn onClick={onFavorite} title="收藏 (F)">
          <Heart
            size={14}
            className={isFavorite ? "fill-red-400 text-red-400" : ""}
          />
        </ToolBtn>
        <ToolBtn onClick={onToggleInfo} active={showInfo} title="信息 (I)">
          <Info size={14} />
        </ToolBtn>
        <ToolBtn onClick={onFullscreen} title="全屏查看">
          <Maximize size={14} />
        </ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  disabled,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded transition-colors ${
        active
          ? "bg-white/25 text-white"
          : "text-white/70 hover:bg-white/15 hover:text-white active:bg-white/25"
      } disabled:pointer-events-none disabled:opacity-25`}
    >
      {children}
    </button>
  );
}
