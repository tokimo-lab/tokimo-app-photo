import { Heart } from "lucide-react";
import { useEffect, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { formatBytes } from "./photo-utils";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/50">{label}</span>
      <p className="text-white/90">{value}</p>
    </div>
  );
}

export function PhotoLightbox({
  photo,
  allPhotos,
  onClose,
  onNavigate,
  onToggleFavorite,
}: {
  photo: PhotoOutput;
  allPhotos: PhotoOutput[];
  onClose: () => void;
  onNavigate: (p: PhotoOutput) => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
}) {
  const idx = allPhotos.findIndex((p) => p.id === photo.id);
  const hasPrev = idx > 0;
  const hasNext = idx < allPhotos.length - 1;
  const [showInfo, setShowInfo] = useState(false);

  const detailQuery = api.mediaLibrary.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const detail = detailQuery.data;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(allPhotos[idx - 1]);
      if (e.key === "ArrowRight" && hasNext) onNavigate(allPhotos[idx + 1]);
      if (e.key === "i") setShowInfo((v) => !v);
      if (e.key === "f" && onToggleFavorite) onToggleFavorite(photo);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    idx,
    hasPrev,
    hasNext,
    allPhotos,
    onClose,
    onNavigate,
    photo,
    onToggleFavorite,
  ]);

  const src = photo.sourceId ? `/api/photos/${photo.id}/image` : undefined;
  const isFav = detail?.isFavorite ?? photo.isFavorite;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90">
      {/* Top toolbar */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        {/* Favorite toggle */}
        {onToggleFavorite && (
          <button
            type="button"
            className="cursor-pointer rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
            onClick={() => onToggleFavorite(photo)}
            title="收藏 (F)"
          >
            <Heart
              className={`h-5 w-5 ${
                isFav ? "fill-red-500 text-red-500" : "text-white"
              }`}
            />
          </button>
        )}

        {/* Info toggle */}
        <button
          type="button"
          className="cursor-pointer rounded-full bg-black/50 px-3 py-2 text-xs text-white transition-colors hover:bg-black/70"
          onClick={() => setShowInfo((v) => !v)}
        >
          ℹ️ 详情
        </button>

        {/* Close */}
        <button
          type="button"
          className="cursor-pointer rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* Previous */}
      {hasPrev && (
        <button
          type="button"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
          onClick={() => onNavigate(allPhotos[idx - 1])}
        >
          ‹
        </button>
      )}

      {/* Next */}
      {hasNext && (
        <button
          type="button"
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
          onClick={() => onNavigate(allPhotos[idx + 1])}
        >
          ›
        </button>
      )}

      {/* Image */}
      <div className="flex h-full w-full items-center justify-center p-12">
        {src ? (
          <img
            src={src}
            alt={photo.title || photo.filename}
            className="max-h-full max-w-full select-none object-contain"
            draggable={false}
          />
        ) : (
          <div className="text-neutral-400">无法加载图片</div>
        )}
      </div>

      {/* Info panel */}
      {showInfo && detail && (
        <div className="absolute bottom-0 right-0 top-0 w-80 overflow-y-auto border-l border-white/10 bg-black/80 p-6 text-sm text-white backdrop-blur">
          <h3 className="mb-4 text-base font-semibold">
            {detail.title || detail.filename}
          </h3>
          <div className="space-y-3">
            {detail.takenAt && (
              <InfoRow
                label="拍摄时间"
                value={new Date(detail.takenAt).toLocaleString()}
              />
            )}
            {detail.cameraMake && (
              <InfoRow
                label="相机"
                value={`${detail.cameraMake} ${detail.cameraModel || ""}`}
              />
            )}
            {detail.lensModel && (
              <InfoRow label="镜头" value={detail.lensModel} />
            )}
            {detail.focalLength && (
              <InfoRow label="焦距" value={`${detail.focalLength}mm`} />
            )}
            {detail.aperture && (
              <InfoRow label="光圈" value={`f/${detail.aperture}`} />
            )}
            {detail.shutterSpeed && (
              <InfoRow label="快门" value={detail.shutterSpeed} />
            )}
            {detail.iso && <InfoRow label="ISO" value={String(detail.iso)} />}
            {detail.width && detail.height && (
              <InfoRow
                label="分辨率"
                value={`${detail.width} × ${detail.height}`}
              />
            )}
            {detail.fileSize && (
              <InfoRow label="文件大小" value={formatBytes(detail.fileSize)} />
            )}
            {detail.locationName && (
              <InfoRow label="位置" value={detail.locationName} />
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70">
        {idx + 1} / {allPhotos.length} — {photo.filename}
      </div>
    </div>
  );
}
