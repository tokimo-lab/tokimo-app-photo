import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { api } from "@/generated/rust-api";
import type { PhotoDetailOutput, PhotoOutput } from "@/generated/rust-types";
import { PhotoInfoPanel } from "./PhotoInfoPanel";

interface PhotoInfoSidebarProps {
  detail: PhotoDetailOutput | undefined;
  photo: PhotoOutput | null;
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
            queryKey: ["/api/apps/photo/item/{id}"],
          });
        },
      },
    );
  }, [detail, editTitle, editDesc, editDate, updateMutation, queryClient]);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/apps/photo/item/{id}"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/item/{id}/faces"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/item/{id}/ocr-results"],
    });
  }, [queryClient]);

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border-base bg-[var(--color-surface-sidebar)] text-sm text-white backdrop-blur">
      {detail ? (
        <>
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
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
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-4">
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
                        className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
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
                        className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
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
                        className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-white outline-none focus:border-blue-500"
                      />
                    </label>
                  </div>
                ) : null
              }
            />
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
            <span className="text-sm font-semibold text-neutral-300">
              照片信息
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="text-xs text-fg-muted">加载中…</div>
          </div>
        </>
      )}
    </div>
  );
}
