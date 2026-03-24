import { useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { PhotoInfoPanel } from "./PhotoInfoPanel";

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

  const detailQuery = api.app.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const detail = detailQuery.data;

  // ── Edit mode state ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDate, setEditDate] = useState("");
  const queryClient = useQueryClient();

  const updateMutation = api.app.updatePhoto.useMutation();

  const startEdit = useCallback(() => {
    setEditTitle(detail?.title || photo.title || "");
    setEditDesc(detail?.description || "");
    setEditDate(detail?.takenAt ? detail.takenAt.slice(0, 16) : "");
    setEditing(true);
  }, [detail, photo]);

  const saveEdit = useCallback(() => {
    updateMutation.mutate(
      {
        photoId: photo.id,
        title: editTitle || undefined,
        description: editDesc || undefined,
        takenAt: editDate ? new Date(editDate).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setEditing(false);
          queryClient.invalidateQueries({
            queryKey: ["api.app.getPhoto"],
          });
        },
      },
    );
  }, [photo.id, editTitle, editDesc, editDate, updateMutation, queryClient]);

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

  const isHeic =
    photo.mimeType === "image/heif" ||
    photo.mimeType === "image/heic" ||
    /\.heic$/i.test(photo.filename) ||
    /\.heif$/i.test(photo.filename);

  const src = photo.sourceId
    ? isHeic
      ? `/api/photos/${photo.id}/thumbnail?w=1920`
      : `/api/photos/${photo.id}/image`
    : undefined;
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
          {/* Edit header */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-300">
              照片信息
            </span>
            {!editing ? (
              <button
                type="button"
                onClick={startEdit}
                className="cursor-pointer rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-white/10"
              >
                编辑
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={saveEdit}
                  className="cursor-pointer rounded bg-blue-600 px-2 py-0.5 text-xs text-white hover:bg-blue-500"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-neutral-400 hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            )}
          </div>

          <PhotoInfoPanel
            detail={detail}
            fallbackTitle={photo.title || photo.filename}
            editForm={
              editing ? (
                <div className="mb-4 space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-500">
                      标题
                    </span>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                      placeholder="照片标题"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-500">
                      描述
                    </span>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                      rows={2}
                      placeholder="照片描述"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-500">
                      拍摄时间
                    </span>
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              ) : null
            }
          />
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70">
        {idx + 1} / {allPhotos.length} — {photo.filename}
      </div>
    </div>
  );
}
