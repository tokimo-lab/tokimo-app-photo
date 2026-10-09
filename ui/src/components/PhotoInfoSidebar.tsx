import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../generated/rust-api";
import type { PhotoDetailOutput, PhotoOutput } from "../generated/rust-types";
import { PhotoInfoPanel } from "./PhotoInfoPanel";

interface PhotoInfoSidebarProps {
  detail: PhotoDetailOutput | undefined;
  photo: PhotoOutput | null;
  onClose: () => void;
  hoveredFaceId: number | null;
  onHoverFace: (id: number | null) => void;
  hoveredOcrId: string | null;
  onHoverOcr: (id: string | null) => void;
  ocrSelectionRanges: Map<string, { start: number; end: number }>;
  onNavigateToPerson?: (personId: string) => void;
  // Viewer-specific OCR editing props
  editingOcrId?: string | null;
  onEditOcr?: (id: string | null) => void;
  pendingBbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null;
  onAddOcr?: () => void;
}

export function PhotoInfoSidebar({
  detail,
  photo,
  onClose,
  hoveredFaceId,
  onHoverFace,
  hoveredOcrId,
  onHoverOcr,
  ocrSelectionRanges,
  onNavigateToPerson,
  editingOcrId,
  onEditOcr,
  pendingBbox,
  onAddOcr,
}: PhotoInfoSidebarProps) {
  const queryClient = useQueryClient();

  // ── Edit mode state ──
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editDate, setEditDate] = useState("");

  const updateMutation = api.photo.updatePhoto.useMutation();

  const startEdit = useCallback(() => {
    if (!detail) return;
    setEditTitle(detail.title || photo?.title || "");
    setEditDesc(detail.description || "");
    setEditDate(detail.takenAt ? detail.takenAt.slice(0, 16) : "");
    setEditing(true);
  }, [detail, photo]);

  const saveEdit = useCallback(() => {
    if (!detail) return;
    updateMutation.mutate(
      {
        photoId: detail.id,
        title: editTitle || undefined,
        description: editDesc || undefined,
        takenAt: editDate ? new Date(editDate).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          setEditing(false);
          queryClient.invalidateQueries({
            queryKey: ["/api/apps/photo/{id}"],
          });
        },
      },
    );
  }, [detail, editTitle, editDesc, editDate, updateMutation, queryClient]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/apps/photo/{id}"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/{id}/faces"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/{id}/ocr-results"],
    });
  }, [queryClient]);

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 w-full flex-col border-l sm:static sm:w-80 sm:shrink-0 border-border-base bg-surface-sidebar text-sm text-fg-primary backdrop-blur">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-base px-4 py-3 sm:px-6 sm:py-4">
        <span className="text-sm font-semibold text-fg-primary">照片信息</span>
        <div className="flex items-center gap-1">
          {detail &&
            (!editing ? (
              <button
                type="button"
                onClick={startEdit}
                className="min-h-11 cursor-pointer rounded px-3 text-xs text-accent-text hover:bg-surface-overlay-hover sm:min-h-0 sm:px-2 sm:py-0.5"
              >
                编辑
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="min-h-11 cursor-pointer rounded bg-accent px-3 text-xs text-fg-on-accent hover:bg-accent-hover sm:min-h-0 sm:px-2 sm:py-0.5"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="min-h-11 cursor-pointer rounded px-3 text-xs text-fg-secondary hover:bg-surface-overlay-hover sm:min-h-0 sm:px-2 sm:py-0.5"
                >
                  取消
                </button>
              </>
            ))}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭照片信息"
            className="flex size-11 cursor-pointer items-center justify-center rounded text-fg-secondary hover:bg-surface-overlay-hover sm:size-7"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      {detail ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain break-words px-4 py-4 sm:px-6">
          <PhotoInfoPanel
            detail={detail}
            fallbackTitle={photo?.title || photo?.filename || ""}
            hoveredFaceId={hoveredFaceId}
            onHoverFace={onHoverFace}
            hoveredOcrId={hoveredOcrId}
            onHoverOcr={onHoverOcr}
            ocrSelectionRanges={ocrSelectionRanges}
            onNavigateToPerson={onNavigateToPerson}
            onRefreshComplete={invalidateAll}
            editingOcrId={editingOcrId}
            onEditOcr={onEditOcr}
            pendingBbox={pendingBbox}
            onAddOcr={onAddOcr}
            editForm={
              editing ? (
                <div className="mb-4 space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-fg-muted">
                      标题
                    </span>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="min-h-11 min-w-0 max-w-full w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-base text-white outline-none sm:text-sm focus:border-blue-500"
                      placeholder="照片标题"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-fg-muted">
                      描述
                    </span>
                    <textarea
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="min-h-11 min-w-0 max-w-full w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-base text-white outline-none sm:text-sm focus:border-blue-500"
                      rows={2}
                      placeholder="照片描述"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-fg-muted">
                      拍摄时间
                    </span>
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="min-h-11 min-w-0 max-w-full w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-base text-white outline-none sm:text-sm focus:border-blue-500"
                    />
                  </label>
                </div>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-xs text-fg-muted">加载中…</div>
        </div>
      )}
    </div>
  );
}
