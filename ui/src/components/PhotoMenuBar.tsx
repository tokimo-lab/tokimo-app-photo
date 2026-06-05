import { useQueryClient } from "@tanstack/react-query";
import { Checkbox, Modal } from "@tokimo/ui";
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
import { useMenuBar, useMessage } from "@/system";
import { usePhotoI18n } from "../i18n";
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
  const id = localStorage.getItem("photo-active-library") ?? undefined;
  const { t } = usePhotoI18n();
  const message = useMessage();
  const qc = useQueryClient();

  // Shared state — provided to page via context
  const [isSelecting, setIsSelecting] = useState(false);
  const [sizeIndex, setSizeIndex] = useState(loadSavedSizeIndex);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);
  const [syncTargetId, setSyncTargetId] = useState<string | null>(null);
  const [syncTargetName, setSyncTargetName] = useState<string>("");

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

  const syncMutation = api.photo.sync.useMutation({
    onSuccess: () => {
      message.success(t("syncStarted"));
      qc.refetchQueries({ queryKey: ["photo"], type: "all" });
    },
    onError: (e) => message.error(e.message || t("syncFailed")),
  });

  const librariesQuery = api.photo.list.useQuery();
  const libraries = librariesQuery.data ?? [];

  const handleRefresh = useCallback(() => {
    api.photo.listPhotos.invalidate(qc);
    api.photo.listTrashedPhotos.invalidate(qc);
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
        { key: "view", label: t("menuView"), items: sizeItems },
        {
          key: "actions",
          label: t("menuActions"),
          items: [
            {
              key: "select",
              label: isSelecting ? t("menuDeselect") : t("menuSelect"),
              icon: <MousePointerClick size={14} />,
              onClick: toggleSelectMode,
            },
            { type: "divider" as const },
            {
              key: "refresh",
              label: t("menuRefresh"),
              icon: <RefreshCw size={14} />,
              onClick: handleRefresh,
            },
            ...(libraries.length > 0
              ? [
                  { type: "divider" as const },
                  ...libraries.map((lib) => ({
                    key: `sync-${lib.id}`,
                    label: t("menuSyncNamedLibrary", { name: lib.name }),
                    icon: <FolderSync size={14} />,
                    onClick: () => {
                      setSyncTargetId(lib.id);
                      setSyncTargetName(lib.name);
                      setSyncClearData(false);
                      setSyncModalOpen(true);
                    },
                  })),
                ]
              : []),
          ],
        },
      ],
      search: {
        appId: id,
        searchType: "photo" as const,
        placeholder: t("menuSearchPlaceholder"),
        onSelect: () => {},
        recentItems: [],
      },
    };
  }, [
    id,
    isSelecting,
    sizeIndex,
    t,
    toggleSelectMode,
    handleRefresh,
    libraries,
  ]);

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
        title={t("menuSyncNamedLibrary", { name: syncTargetName })}
        okText={t("syncModalOk")}
        cancelText={t("commonCancel")}
        confirmLoading={syncMutation.isPending}
        onCancel={() => setSyncModalOpen(false)}
        onOk={async () => {
          if (!syncTargetId) return;
          try {
            await syncMutation.mutateAsync({
              id: syncTargetId,
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
          {t("syncModalClearData")}
        </Checkbox>
        <p className="mt-2 text-xs text-[var(--color-fg-muted)]">
          {t("syncModalHint")}
        </p>
      </Modal>
    </PhotoMenuBarContext.Provider>
  );
}
