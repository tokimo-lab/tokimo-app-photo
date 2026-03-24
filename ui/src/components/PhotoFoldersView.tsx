import { Empty, Spin } from "@tokiomo/components";
import { ChevronRight, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";

export function PhotoFoldersView({
  appId,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
  onNavigateToPerson,
}: {
  appId: string;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (photo: PhotoOutput) => void;
  onNavigateToPerson?: (personId: string) => void;
}) {
  const [currentPath, setCurrentPath] = useState("/");
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  const foldersQuery = api.app.listPhotoFolders.useQuery(
    { appId, path: currentPath },
    { enabled: !!appId },
  );

  const folders = foldersQuery.data?.folders ?? [];
  const photos = foldersQuery.data?.photos ?? [];

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split("/").filter(Boolean);
    const crumbs = [{ label: "根目录", path: "/" }];
    let acc = "";
    for (const p of parts) {
      acc += `/${p}`;
      crumbs.push({ label: p, path: acc });
    }
    return crumbs;
  }, [currentPath]);

  if (foldersQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />}
            <button
              type="button"
              className={`cursor-pointer rounded px-1.5 py-0.5 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                i === breadcrumbs.length - 1
                  ? "font-medium text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
              onClick={() => setCurrentPath(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {/* Subdirectories */}
      {folders.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {folders.map((folder) => (
            <button
              key={folder.path}
              type="button"
              className="group flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--glass-border)] bg-white/50 p-3 text-left transition-colors hover:bg-neutral-50 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              onClick={() => setCurrentPath(folder.path)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                {folder.coverPhotoId ? (
                  <img
                    src={`/api/photos/${folder.coverPhotoId}/thumbnail?w=80`}
                    alt=""
                    className="h-full w-full rounded-lg object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <FolderOpen className="h-5 w-5 text-neutral-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {folder.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {folder.photoCount} 张
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Photos in current directory */}
      {photos.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
          {photos.map((photo) => (
            <PhotoThumbnail
              key={photo.id}
              photo={photo}
              onClick={setSelectedPhoto}
              onToggleFavorite={onToggleFavorite}
              isSelecting={isSelecting}
              isSelected={selectedIds?.has(photo.id)}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      {folders.length === 0 && photos.length === 0 && (
        <Empty description="此文件夹为空" />
      )}

      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          allPhotos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
          onToggleFavorite={onToggleFavorite}
          onNavigateToPerson={onNavigateToPerson}
        />
      )}
    </>
  );
}
