import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FolderSearch, Image, Plus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../generated/rust-api";
import { useContainerWidth } from "../shared/hooks/use-container-width";
import { useSidebarCollapsed } from "../shared/hooks/use-sidebar-collapsed";
import {
  useRuntimeCtx,
  useStandaloneDocumentScroll,
  useWindowActions,
  useWindowNav,
} from "@tokimo/sdk";
import { registerBridge } from "../modal-bridge";
import { useLibraryItemProgress } from "../hooks/useLibraryItemProgress";
import { usePersonEntityEvents } from "../hooks/usePersonEntityEvents";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoMenuBar from "./PhotoMenuBar";
import PhotoSidebar from "./PhotoSidebar";

function parseLibraryId(route: string): string | null {
  const match = route.match(/^\/library\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export default function PhotoApp() {
  const documentScroll = useStandaloneDocumentScroll();
  const { t } = useTranslation();
  const { route, replace } = useWindowNav();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const mobile = containerWidth > 0 && containerWidth < 720;
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "photo",
    mobile,
  );

  const ctx = useRuntimeCtx();
  const { openModalWindow } = useWindowActions();

  const activeLibraryId = useMemo(() => parseLibraryId(route), [route]);
  usePersonEntityEvents(true);

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
      const bridgeId = registerBridge({
        kind: "library-editor",
        ctx,
        onSaved: (id: string) => {
          replace(`/library/${id}`);
        },
      });
      openModalWindow({
        component: () => import("./PhotoLibraryEditorWindow"),
        title: isEdit ? "TokimoPhoto · 设置" : "TokimoPhoto · 新建图库",
        width: 720,
        height: 640,
        metadata: {
          bridgeId,
          ...(isEdit ? { photoId: opts.photoId } : {}),
        } as Record<string, unknown>,
      });
    },
    [openModalWindow, replace, ctx],
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
    <div
      ref={containerRef}
      className={`relative flex min-w-0 [--photo-library-bar-height:calc(61px+var(--app-safe-area-top,0px))] ${documentScroll ? "min-h-dvh" : "h-full"} ${mobile ? "flex-col" : ""}`}
    >
      <PhotoSidebar
        libraries={libraries}
        activeId={activeLibraryId}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        mobile={mobile}
        documentScroll={documentScroll}
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
      <div
        className={`app-safe-area relative min-w-0 flex-1 bg-surface-base ${documentScroll ? "overflow-visible" : "overflow-auto"}`}
      >
        {activeLibraryId && (
          <PhotoMenuBar>
            <PhotoAppPage
              key={activeLibraryId}
              photoLibraryId={activeLibraryId}
              mobile={mobile}
              syncing={!!syncProgress[activeLibraryId]?.isActive}
            />
          </PhotoMenuBar>
        )}
      </div>
    </div>
  );
}
