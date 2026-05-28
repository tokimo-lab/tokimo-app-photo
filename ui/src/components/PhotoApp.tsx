import { useQueryClient } from "@tanstack/react-query";
import { AppSetupGuide, Spin } from "@tokimo/ui";
import { Camera, Image, Plus, Search } from "lucide-react";
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
    const isZh = ctx.locale.startsWith("zh");
    return (
      <AppSetupGuide
        imageSrc="icon.png"
        accentColor="violet"
        title={isZh ? "开始使用 TokimoPhoto" : "Get Started with TokimoPhoto"}
        description={
          isZh
            ? "创建一个图库来管理你的照片与截图"
            : "Create a library to organize your photos and screenshots"
        }
        features={[
          {
            icon: Image,
            label: isZh ? "导入照片与截图" : "Import photos and screenshots",
          },
          {
            icon: Camera,
            label: isZh
              ? "按相册和时间线智能整理"
              : "Organize by album and timeline",
          },
          {
            icon: Search,
            label: isZh
              ? "快速搜索，回忆精选"
              : "Quick search, curated memories",
          },
        ]}
        actionLabel={isZh ? "新建图库" : "New Photo Library"}
        actionIcon={Plus}
        onAction={openSettings}
      />
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
