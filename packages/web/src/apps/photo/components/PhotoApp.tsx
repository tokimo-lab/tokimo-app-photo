import { useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokimo/ui";
import { Camera, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useSyncProgress } from "@/shared/hooks/use-sync-progress";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoSettingsModal from "./PhotoSettingsModal";
import PhotoSidebar from "./PhotoSidebar";

const STORAGE_KEY = "photo-active-library";

export default function PhotoApp() {
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    containerWidth > 0 && containerWidth < 720,
  );
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!libraries?.length || initialized.current) return;
    initialized.current = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    const id =
      saved && libraries.some((l) => l.id === saved) ? saved : libraries[0].id;
    setActiveLibraryId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, [libraries]);

  const handleSelectLibrary = (id: string) => {
    setActiveLibraryId(id);
    localStorage.setItem(STORAGE_KEY, id);
  };

  // ── Sync progress tracking (WS-driven + fallback polling) ──
  const queryClient = useQueryClient();

  const syncProgress = useSyncProgress({
    libraries,
    progressQueryKey: (id) => api.photo.getSyncProgress.queryKey({ id }),
    fetchProgress: (id) => api.photo.getSyncProgress.fetch({ id }),
    onContentRefresh: () => {
      api.photo.listPhotos.invalidate(queryClient);
      api.photo.listPhotoAlbums.invalidate(queryClient);
    },
    onLibraryRefresh: () => {
      api.photo.list.invalidate(queryClient);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (!libraries?.length) {
    return (
      <>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400">
            <Camera className="h-8 w-8" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-fg-primary">
              开始使用 TokimoPhoto
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              创建一个图库来管理你的照片与截图
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            新建图库
          </button>
        </div>
        <PhotoSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="grid h-full"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? 48 : 200}px 1fr` }}
      >
        <PhotoSidebar
          libraries={libraries}
          activeId={activeLibraryId}
          onSelect={handleSelectLibrary}
          collapsed={sidebarCollapsed}
          onCreateClick={() => setSettingsOpen(true)}
          onSettingsClick={() => setSettingsOpen(true)}
          syncProgress={syncProgress}
          onToggleCollapse={onToggleCollapse}
        />
        <div className="min-w-0 flex-1 overflow-auto">
          {activeLibraryId && (
            <PhotoAppPage
              key={activeLibraryId}
              photoLibraryId={activeLibraryId}
              syncing={!!syncProgress[activeLibraryId]?.isActive}
            />
          )}
        </div>
      </div>
      <PhotoSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
