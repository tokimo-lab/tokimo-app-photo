import { useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokimo/ui";
import { Camera, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import PhotoLibraryEditor from "@/apps/settings/admin/PhotoLibraryEditor";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useSyncProgress } from "@/shared/hooks/use-sync-progress";
import { useWindowNav } from "@/system";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoSidebar from "./PhotoSidebar";

type ViewMode = "photo" | "settings" | "settings-new";

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
  const { params, replace } = useWindowNav();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    containerWidth > 0 && containerWidth < 720,
  );
  const [mode, setMode] = useState<ViewMode>("photo");

  const activeLibraryId = params.libraryId ?? null;

  useEffect(() => {
    if (!libraries?.length) return;
    if (params.libraryId) {
      const valid = libraries.some((l) => l.id === params.libraryId);
      if (!valid) replace(`/library/${libraries[0].id}`);
      return;
    }
    replace(`/library/${libraries[0].id}`);
  }, [libraries, params.libraryId, replace]);

  const openSettings = useCallback(() => {
    setMode("settings");
  }, []);

  const openCreate = useCallback(() => {
    setMode("settings-new");
  }, []);

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
    setMode("photo");
  };

  const handleSaved = (savedId: string) => {
    replace(`/library/${savedId}`);
    setMode("photo");
  };

  const handleDeleted = () => {
    const remaining = (libraries ?? []).filter((l) => l.id !== activeLibraryId);
    const next = remaining[0]?.id;
    if (next) {
      replace(`/library/${next}`);
    } else {
      replace("/");
    }
    setMode("photo");
  };

  const handleCancel = () => {
    setMode("photo");
  };

  // ── Sync progress tracking (WS-driven + fallback polling) ──
  const queryClient = useQueryClient();

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
    if (mode === "settings-new") {
      return (
        <div ref={containerRef} className="relative flex h-full">
          <PhotoSidebar
            libraries={[]}
            activeId={null}
            onSelect={handleSelectLibrary}
            collapsed={sidebarCollapsed}
            onCreateClick={openCreate}
            onSettingsClick={openSettings}
            onToggleCollapse={onToggleCollapse}
            settingsActive
          />
          <div className="min-w-0 flex-1 overflow-hidden h-full">
            <PhotoLibraryEditor
              key="__new__"
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </div>
        </div>
      );
    }
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
          onClick={openCreate}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        >
          <Plus className="h-4 w-4" />
          新建图库
        </button>
      </div>
    );
  }

  const isSettingsView = mode !== "photo";

  return (
    <div ref={containerRef} className="relative flex h-full">
      <PhotoSidebar
        libraries={libraries}
        activeId={activeLibraryId}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        onCreateClick={openCreate}
        onSettingsClick={openSettings}
        syncProgress={syncProgress}
        onToggleCollapse={onToggleCollapse}
        settingsActive={isSettingsView}
      />
      <div className="min-w-0 flex-1 overflow-auto">
        {mode === "settings-new" ? (
          <div className="animate-settings-pane-in h-full">
            <PhotoLibraryEditor
              key="__new__"
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </div>
        ) : mode === "settings" && activeLibraryId ? (
          <div className="animate-settings-pane-in h-full">
            <PhotoLibraryEditor
              key={activeLibraryId}
              photoId={activeLibraryId}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
              onCancel={handleCancel}
            />
          </div>
        ) : (
          activeLibraryId && (
            <PhotoAppPage
              key={activeLibraryId}
              photoLibraryId={activeLibraryId}
              syncing={!!syncProgress[activeLibraryId]?.isActive}
            />
          )
        )}
      </div>
    </div>
  );
}
