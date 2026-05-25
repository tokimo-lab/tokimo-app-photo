import { useQueryClient } from "@tanstack/react-query";
import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FolderSearch, Image, Plus, Upload } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useJobProgress } from "@/shared/hooks/use-sync-progress";
import { useWindowActions, useWindowId, useWindowNav } from "@/system";
import { PickCancelled, pickWithBridge } from "@/system/window-bridge";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoSidebar from "./PhotoSidebar";

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
  const { t } = useTranslation();
  const { params, replace } = useWindowNav();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    containerWidth > 0 && containerWidth < 720,
  );

  const windowId = useWindowId();
  const { openModalWindow } = useWindowActions();

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

  const openEditorModal = useCallback(
    async (opts: { photoId?: string } = {}) => {
      const isEdit = !!opts.photoId;
      try {
        const created = await pickWithBridge<{ id: string }>(openModalWindow, {
          component: () =>
            import("@/apps/settings/admin/PhotoLibraryEditorWindow"),
          parentWindowId: windowId,
          title: isEdit ? "TokimoPhoto · 设置" : "TokimoPhoto · 新建图库",
          width: 720,
          height: 640,
          noResize: true,
          noMinimize: true,
          metadata: isEdit
            ? ({ photoId: opts.photoId } as Record<string, unknown>)
            : undefined,
        });
        if (!isEdit) {
          replace(`/library/${created.id}`);
        }
      } catch (err) {
        if (err instanceof PickCancelled) return;
        throw err;
      }
    },
    [openModalWindow, windowId, replace],
  );

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
  };

  // ── Job progress tracking (WS-driven + fallback polling) ──
  const queryClient = useQueryClient();

  const syncProgress = useJobProgress({
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
      <AppSetupGuide
        imageSrc="/page-icons/photo.png"
        accentColor="violet"
        title={t("common.setupGuide.getStarted", { name: "TokimoPhoto" })}
        description={t("common.setupGuide.photoTagline")}
        features={(
          t("common.setupGuide.photoFeatures", {
            returnObjects: true,
          }) as string[]
        ).map((label, i) => ({
          icon: [Upload, Image, FolderSearch][i],
          label,
        }))}
        actionLabel={t("common.setupGuide.photoAction")}
        actionIcon={Plus}
        onAction={() => {
          void openEditorModal();
        }}
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
        onCreateClick={() => {
          void openEditorModal();
        }}
        onSettingsClick={() => {
          if (activeLibraryId) {
            void openEditorModal({ photoId: activeLibraryId });
          }
        }}
        syncProgress={syncProgress}
        onToggleCollapse={onToggleCollapse}
      />
      <div className="relative min-w-0 flex-1 overflow-auto">
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
