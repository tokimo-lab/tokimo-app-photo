import { useQueryClient } from "@tanstack/react-query";
import { Checkbox, Modal } from "@tokiomo/components";
import {
  FolderSync,
  LayoutGrid,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { api } from "@/generated/rust-api";
import type { MenuBarConfig } from "@/system";
import { useMenuBar, useMessage, useWindowNav } from "@/system";
import {
  loadSavedSizeIndex,
  PHOTO_SIZE_LEVELS,
  saveSizeIndex,
} from "./PhotoSizeSlider";

// ── Shared state context (consumed by PhotoAppPage) ─────────────────────────

interface PhotoMenuBarState {
  isSelecting: boolean;
  setIsSelecting: (v: boolean) => void;
  toggleSelectMode: () => void;
  sizeIndex: number;
  setSizeIndex: (v: number) => void;
}

const PhotoMenuBarContext = createContext<PhotoMenuBarState | null>(null);

export function usePhotoMenuBarState(): PhotoMenuBarState {
  const ctx = useContext(PhotoMenuBarContext);
  if (!ctx)
    throw new Error(
      "usePhotoMenuBarState must be used within PhotoMenuBar wrapper",
    );
  return ctx;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PhotoMenuBar({ children }: { children: ReactNode }) {
  const { params } = useWindowNav();
  const id = params.appId as string | undefined;
  const message = useMessage();
  const qc = useQueryClient();

  // Shared state — provided to page via context
  const [isSelecting, setIsSelecting] = useState(false);
  const [sizeIndex, setSizeIndex] = useState(loadSavedSizeIndex);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);

  const clearSelection = useCallback(() => {
    setIsSelecting(false);
  }, []);

  const toggleSelectMode = useCallback(() => {
    if (isSelecting) {
      clearSelection();
    } else {
      setIsSelecting(true);
    }
  }, [isSelecting, clearSelection]);

  const syncMutation = api.app.sync.useMutation({
    onSuccess: () => {
      message.success("同步已开始");
      api.app.listPhotos.invalidate(qc);
    },
    onError: (e) => message.error(e.message || "同步失败"),
  });

  const handleRefresh = useCallback(() => {
    api.app.listPhotos.invalidate(qc);
    api.app.listTrashedPhotos.invalidate(qc);
  }, [qc]);

  const menuBarConfig: MenuBarConfig | null = useMemo(() => {
    if (!id) return null;

    const sizeItems = PHOTO_SIZE_LEVELS.map((level, i) => ({
      key: `size-${i}`,
      label: `${level.label}${i === sizeIndex ? " ✓" : ""}`,
      icon: <LayoutGrid size={14} />,
      onClick: () => {
        setSizeIndex(i);
        saveSizeIndex(i);
      },
    }));

    return {
      menus: [
        { key: "view", label: "显示", items: sizeItems },
        {
          key: "actions",
          label: "操作",
          items: [
            {
              key: "select",
              label: isSelecting ? "取消选择" : "选择",
              icon: <MousePointerClick size={14} />,
              onClick: toggleSelectMode,
            },
            { type: "divider" as const },
            {
              key: "refresh",
              label: "刷新",
              icon: <RefreshCw size={14} />,
              onClick: handleRefresh,
            },
            {
              key: "sync",
              label: "同步资料库",
              icon: <FolderSync size={14} />,
              onClick: () => {
                setSyncClearData(false);
                setSyncModalOpen(true);
              },
            },
          ],
        },
      ],
      search: {
        appId: id,
        searchType: "photo" as const,
        placeholder: "搜索照片…",
        onSelect: () => {},
        recentItems: [],
      },
    };
  }, [id, isSelecting, sizeIndex, toggleSelectMode, handleRefresh]);

  useMenuBar(menuBarConfig);

  const contextValue = useMemo<PhotoMenuBarState>(
    () => ({
      isSelecting,
      setIsSelecting,
      toggleSelectMode,
      sizeIndex,
      setSizeIndex,
    }),
    [isSelecting, toggleSelectMode, sizeIndex],
  );

  return (
    <PhotoMenuBarContext.Provider value={contextValue}>
      {children}

      <Modal
        open={syncModalOpen}
        title="同步资料库"
        okText="开始同步"
        cancelText="取消"
        confirmLoading={syncMutation.isPending}
        onCancel={() => setSyncModalOpen(false)}
        onOk={async () => {
          if (!id) return;
          try {
            await syncMutation.mutateAsync({
              id,
              clearData: syncClearData,
            });
          } finally {
            setSyncModalOpen(false);
          }
        }}
      >
        <Checkbox
          checked={syncClearData}
          onChange={(e) => setSyncClearData(e.target.checked)}
        >
          清空数据重新同步
        </Checkbox>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          勾选后将删除所有照片数据并重新完整同步，适合修复数据异常或新增字段后重建。
        </p>
      </Modal>
    </PhotoMenuBarContext.Provider>
  );
}
