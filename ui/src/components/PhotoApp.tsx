import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FolderSearch, Image, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../generated/rust-api";
import { useContainerWidth } from "../shared/hooks/use-container-width";
import { useSidebarCollapsed } from "../shared/hooks/use-sidebar-collapsed";
import {
  useWindowActions,
  useWindowNav,
} from "@tokimo/sdk";
import { useLibraryItemProgress } from "../hooks/useLibraryItemProgress";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoMenuBar from "./PhotoMenuBar";
import PhotoSidebar from "./PhotoSidebar";

function parseLibraryId(route: string): string | null {
  const match = route.match(/^\/library\/([^/]+)/);
  return match?.[1] ?? null;
}

export default function PhotoApp() {
  const { t } = useTranslation();
  const { route, replace } = useWindowNav();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    containerWidth > 0 && containerWidth < 720,
  );

  const { openModalWindow } = useWindowActions();

  const activeLibraryId = useMemo(() => parseLibraryId(route), [route]);

  useEffect(() => {
    if (!libraries?.length) return;
    const currentLibraryId = parseLibraryId(route);
    if (currentLibraryId) {
      const valid = libraries.some((l) => l.id === currentLibraryId);
      if (!valid) replace(`/library/${libraries[0].id}`);
      return;
    }
    replace(`/library/${libraries[0].id}`);
  }, [libraries, route, replace]);

  const openEditorModal = useCallback(
    (opts: { photoId?: string } = {}) => {
      const isEdit = !!opts.photoId;
      openModalWindow({
        component: () => import("./PhotoLibraryEditorWindow"),
        title: isEdit ? "TokimoPhoto · 设置" : "TokimoPhoto · 新建图库",
        width: 720,
        height: 640,
        metadata: {
          ...(isEdit ? { photoId: opts.photoId } : {}),
          onSaved: (id: string) => {
            replace(`/library/${id}`);
          },
        } as Record<string, unknown>,
      });
    },
    [openModalWindow, replace],
  );

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
  };

  const syncProgress = useLibraryItemProgress(libraries);

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
          <PhotoMenuBar>
            <PhotoAppPage
              key={activeLibraryId}
              photoLibraryId={activeLibraryId}
              syncing={!!syncProgress[activeLibraryId]?.isActive}
            />
          </PhotoMenuBar>
        )}
      </div>
    </div>
  );
}
