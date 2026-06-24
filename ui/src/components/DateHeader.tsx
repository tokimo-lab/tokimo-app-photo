import { Check } from "lucide-react";
import { useCallback } from "react";
import { useWindowActions } from "@tokimo/sdk";
import type { PhotoOutput } from "../generated/rust-api";
import type { DateGroup } from "./photo-utils";

export function DateHeader({
  group,
  appId,
  isSelecting,
  selectedIds,
  onSelect,
}: {
  group: DateGroup;
  appId: string;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
}) {
  const { openWindow } = useWindowActions();
  const allSelected =
    isSelecting && group.photos.every((p) => selectedIds?.has(p.id));

  const handleDateClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      openWindow({
        type: "page",
        appId,
        title: group.label,
        metadata: {
          appId,
          tab: "timeline",
          initialDate: group.date,
        },
        forceNew: true,
      });
    },
    [openWindow, appId, group.label, group.date],
  );

  return (
    <div
      className={`group/date relative mb-0.5 flex items-center py-1 ${
        isSelecting ? "pl-7" : "pl-0 hover:pl-7"
      }`}
      style={{
        transition: "padding-left 280ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <button
        type="button"
        className={`absolute left-0 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 ${
          allSelected
            ? "border-orange-500 bg-orange-500 opacity-100"
            : isSelecting
              ? "border-border-base bg-fill-tertiary/50 opacity-80 hover:opacity-100  "
              : "border-border-base bg-fill-tertiary/50 opacity-0 group-hover/date:opacity-80  "
        }`}
        style={{
          transition:
            "opacity 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        onClick={() => {
          if (!onSelect) return;
          for (const p of group.photos) {
            if (allSelected || !selectedIds?.has(p.id)) onSelect(p);
          }
        }}
        title={`全选 ${group.label}`}
      >
        {allSelected && (
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        )}
      </button>
      <button
        type="button"
        className="cursor-pointer text-sm font-semibold text-fg-secondary hover:text-fg-primary hover:underline"
        onClick={handleDateClick}
      >
        {group.label}
      </button>
      <span className="ml-2 text-xs text-fg-muted">
        {group.photos.length} 张
      </span>
    </div>
  );
}
