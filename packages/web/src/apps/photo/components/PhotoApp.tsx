import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokiomo/components";
import { Camera, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useJobEvents } from "@/system/events/useJobEvents";
import PhotoAppPage from "../pages/PhotoAppPage";
import PhotoSettingsModal from "./PhotoSettingsModal";
import PhotoSidebar from "./PhotoSidebar";

const STORAGE_KEY = "photo-active-library";

export default function PhotoApp() {
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const sidebarCollapsed = containerWidth > 0 && containerWidth < 720;
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

  // ── Sync progress tracking ──
  const queryClient = useQueryClient();

  const syncProgressQueries = useQueries({
    queries: (libraries ?? []).map((lib) => ({
      queryKey: api.photo.getSyncProgress.queryKey({ id: lib.id }),
      queryFn: () => api.photo.getSyncProgress.fetch({ id: lib.id }),
      enabled: lib.syncStatus === "syncing",
      refetchInterval: 3000,
      staleTime: 2000,
    })),
  });

  const syncProgress: Record<string, { isActive: boolean; pct: number }> = {};
  for (let i = 0; i < (libraries ?? []).length; i++) {
    const lib = libraries![i];
    const q = syncProgressQueries[i];
    if (q?.data) {
      const d = q.data;
      const total = d.completed + d.running + d.pending + d.failed;
      const pct = total > 0 ? Math.round((d.completed / total) * 100) : 0;
      const isActive = d.status === "syncing" || d.running > 0 || d.pending > 0;
      if (isActive) {
        syncProgress[lib.id] = { isActive, pct };
      }
    } else if (lib.syncStatus === "syncing") {
      syncProgress[lib.id] = { isActive: true, pct: 0 };
    }
  }

  useJobEvents({
    onEvent: (event) => {
      if (event.type === "job_update") {
        const payload = event.job.payload as Record<string, unknown>;
        const appId = payload?.appId as string | undefined;
        if (appId && (libraries ?? []).some((l) => l.id === appId)) {
          queryClient.invalidateQueries({
            queryKey: api.photo.getSyncProgress.queryKey({ id: appId }),
          });
          if (
            event.job.status === "completed" ||
            event.job.status === "failed"
          ) {
            api.photo.list.invalidate(queryClient);
            api.photo.listPhotos.invalidate(queryClient);
          }
        }
      }
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
        />
        <div className="min-w-0 flex-1 overflow-auto">
          {activeLibraryId && <PhotoAppPage photoLibraryId={activeLibraryId} />}
        </div>
      </div>
      <PhotoSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
