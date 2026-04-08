import { useQueryClient } from "@tanstack/react-query";
import { CornerDownLeft, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoOcrResultItem } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";

export function OcrResultRow({
  r,
  isHovered,
  isEditing,
  range,
  pendingBbox,
  onHover,
  onStartEdit,
  onFinishEdit,
  onDelete,
}: {
  r: PhotoOcrResultItem;
  isHovered: boolean;
  isEditing: boolean;
  range?: { start: number; end: number };
  pendingBbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null;
  onHover: (id: string | null) => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onDelete: () => void;
}) {
  const [editText, setEditText] = useState(r.text);
  const [itemHovered, setItemHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const updateMutation = api.photo.updateOcrResult.useMutation();
  const deleteMutation = api.photo.deleteOcrResult.useMutation();

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditText(r.text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isEditing, r.text]);

  const invalidateOcr = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/{id}/ocr-results"],
    });
  }, [queryClient]);

  const handleSubmit = useCallback(() => {
    const trimmed = editText.trim();
    const textChanged = trimmed && trimmed !== r.text;
    const bboxChanged = pendingBbox != null;
    if (!textChanged && !bboxChanged) {
      onFinishEdit();
      return;
    }
    const payload: {
      ocrResultId: number;
      text?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      angle?: number;
      corners?: [number, number][];
    } = { ocrResultId: Number(r.id) };
    if (textChanged) payload.text = trimmed;
    if (bboxChanged) {
      const { angle: bboxAngle, corners: bboxCorners, ...coords } = pendingBbox;
      Object.assign(payload, coords);
      if (bboxAngle != null) payload.angle = bboxAngle;
      if (bboxCorners) payload.corners = bboxCorners;
    }
    updateMutation.mutate(payload, {
      onSuccess: invalidateOcr,
      onSettled: onFinishEdit,
    });
  }, [
    editText,
    r.id,
    r.text,
    pendingBbox,
    updateMutation,
    onFinishEdit,
    invalidateOcr,
  ]);

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(
      { ocrResultId: Number(r.id) },
      {
        onSuccess: () => {
          invalidateOcr();
          onDelete();
        },
      },
    );
  }, [deleteMutation, r.id, invalidateOcr, onDelete]);

  const textChars = Array.from(r.text);
  const hasRange = range && range.start < range.end;

  // Shared min-height to prevent visual jump between display / edit modes
  const rowClass = "rounded px-2 py-1 text-sm leading-relaxed min-h-[1.875rem]";

  if (isEditing) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: editable OCR row
      <div
        className={`${rowClass} flex items-center gap-1 bg-white/10`}
        onMouseEnter={() => onHover(r.id)}
        onMouseLeave={() => onHover(null)}
      >
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            else if (e.key === "Escape") onFinishEdit();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          placeholder={r.text}
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          title="确认 (Enter)"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded p-0.5 text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
          title="删除此识别区域"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onFinishEdit}
          className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          title="取消 (Esc)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: OCR row with hover tracking
    <div
      className={`${rowClass} flex cursor-default transition-colors ${
        isHovered
          ? "bg-emerald-400/15 text-white"
          : hasRange
            ? "bg-white/5 text-white"
            : "bg-white/5 text-white/80 hover:bg-white/10"
      }`}
      onMouseEnter={() => {
        setItemHovered(true);
        onHover(r.id);
      }}
      onMouseLeave={() => {
        setItemHovered(false);
        onHover(null);
      }}
    >
      <span className="min-w-0 flex-1 break-all">
        {hasRange ? (
          <>
            {textChars.slice(0, range.start).join("")}
            <mark className="rounded-sm bg-blue-400/30 text-white">
              {textChars.slice(range.start, range.end).join("")}
            </mark>
            {textChars.slice(range.end).join("")}
          </>
        ) : (
          r.text
        )}
      </span>
      {/* Right-aligned: confidence or manual indicator + edit icon */}
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 self-center">
        {r.score != null ? (
          <span className="text-xs text-white/30">
            {Math.round(r.score * 100)}%
          </span>
        ) : (
          <span className="text-xs text-white/20" title="手动编辑">
            ✎
          </span>
        )}
        {itemHovered && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="inline-flex items-center rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
            title="编辑识别文字"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}
