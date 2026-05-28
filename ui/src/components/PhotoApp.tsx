import { useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokimo/ui";
import { Camera, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useSyncProgress } from "@/shared/hooks/use-sync-progress";
import { useWindowActions, useWindowId } from "@/system";
import { useAppCtx } from "../AppContext";
import { registerBridge } from "../modal-bridge";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoSidebar from "./PhotoSidebar";

const STORAGE_KEY = "photo-active-library";

/**
 * Job types counted by GET /api/apps/photo/{id}/sync-progress.
 * MUST stay in sync with `packages/rust-server/src/apps/photo/handlers/sync.rs`
 * (the `job_types` array in `get_sync_progress`).
 *
 * Single-item refresh jobs (photo_ocr_single / photo_clip_single /
 * photo_face_single) are intentionally NOT here — they share appId but
 * don't contribute to the scan aggregate.
 */
const PHOTO_SCAN_JOB_TYPES = [
  "file_scrape",
  "photo_ocr_scan",
  "photo_clip_scan",
  "photo_face_scan",
  "photo_geocode_scan",
] as const;

export default function PhotoApp() {
  const ctx = useAppCtx();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    containerWidth > 0 && containerWidth < 720,
  );
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const { openModalWindow } = useWindowActions();
  const parentWindowId = useWindowId();
  const initialized = useRef(false);
  const queryClient = useQueryClient();

  const openSettings = (opts?: { photoId?: string }) => {
    const bridgeId = registerBridge({
      kind: "settings",
      shell: ctx.shell,
      photoId: opts?.photoId,
      onMutated: () => api.photo.list.invalidate(queryClient),
    });
    openModalWindow({
      component: () => import("./PhotoSettingsWindow"),
      parentWindowId,
      title: opts?.photoId ? "图库设置" : "TokimoPhoto 设置",
      width: 960,
      height: 640,
      metadata: { bridgeId },
    });
  };

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

  const syncProgress = useSyncProgress({
    libraries,
    progressQueryKey: (id) => api.photo.getSyncProgress.queryKey({ id }),
    fetchProgress: (id) => api.photo.getSyncProgress.fetch({ id }),
    scanJobTypes: PHOTO_SCAN_JOB_TYPES,
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
          onClick={openSettings}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          新建图库
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex h-full">
      <PhotoSidebar
        libraries={libraries}
        activeId={activeLibraryId}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        onCreateClick={() => openSettings()}
        onSettingsClick={() =>
          openSettings({ photoId: activeLibraryId ?? undefined })
        }
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
  );
}
