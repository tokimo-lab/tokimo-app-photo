import { Button, Empty, Spin } from "@tokimo/ui";
import { useRuntimeCtx, useWindowActions } from "@tokimo/sdk";
import { Grid3x3, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { PhotoAlbumOutput, PhotoOutput } from "../generated/rust-api";
import { api } from "../generated/rust-api";
import { thumbUrl } from "../lib/thumb";
import { registerBridge } from "../modal-bridge";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { PAGE_SIZE } from "./photo-utils";

// ── Album Detail View ────────────────────────────────────────────────────────

function AlbumDetailView({
  album,
  onBack,
  onToggleFavorite,
  onDeleteAlbum,
  onNavigateToPerson,
}: {
  album: PhotoAlbumOutput;
  onBack: () => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  onDeleteAlbum: (albumId: string) => void;
  onNavigateToPerson?: (personId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  const photosQuery = api.photo.listAlbumPhotos.useQuery(
    { albumId: album.id, page, pageSize: PAGE_SIZE },
    { enabled: true },
  );

  const photos = photosQuery.data?.items ?? [];
  const total = photosQuery.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="cursor-pointer text-sm text-fg-muted hover:text-fg-secondary"
            onClick={onBack}
          >
            ← 返回
          </button>
          <h3 className="text-lg font-semibold text-fg-primary">
            {album.name}
          </h3>
          <span className="text-sm text-fg-muted">{total} 张</span>
        </div>
        <Button
          onClick={() => onDeleteAlbum(album.id)}
          icon={<Trash2 className="h-4 w-4" />}
        >
          删除
        </Button>
      </div>

      {album.description && (
        <p className="text-sm text-fg-muted">{album.description}</p>
      )}

      {/* Photos grid */}
      {photosQuery.isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spin />
        </div>
      ) : photos.length > 0 ? (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
            {photos.map((photo) => (
              <PhotoThumbnail
                key={photo.id}
                photo={photo}
                onClick={setSelectedPhoto}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
          {photos.length < total && (
            <div className="flex justify-center py-4">
              <Button onClick={() => setPage((p) => p + 1)}>加载更多</Button>
            </div>
          )}
        </>
      ) : (
        <Empty description="相册内暂无照片" />
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
    </div>
  );
}

// ── Albums Grid ──────────────────────────────────────────────────────────────

export function PhotoAlbumsView({
  appId,
  albums,
  isLoading,
  onToggleFavorite,
  onRefresh,
  onNavigateToPerson,
}: {
  appId: string;
  albums: PhotoAlbumOutput[];
  isLoading: boolean;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  onRefresh: () => void;
  onNavigateToPerson?: (personId: string) => void;
}) {
  const ctx = useRuntimeCtx();
  const { openModalWindow } = useWindowActions();
  const [activeAlbum, setActiveAlbum] = useState<PhotoAlbumOutput | null>(null);

  const deleteMutation = api.photo.deletePhotoAlbum.useMutation({
    onSuccess: () => {
      setActiveAlbum(null);
      onRefresh();
    },
  });

  const openCreateAlbumWindow = useCallback(() => {
    const bridgeId = registerBridge({
      kind: "create-album",
      ctx,
      appId,
      onCreated: onRefresh,
    });
    openModalWindow({
      component: () => import("./CreateAlbumWindow"),
      title: "新建相册",
      width: 440,
      height: 320,
      metadata: { bridgeId },
    });
  }, [appId, ctx, onRefresh, openModalWindow]);

  const handleDelete = useCallback(
    (albumId: string) => {
      deleteMutation.mutate({ albumId });
    },
    [deleteMutation.mutate],
  );

  if (activeAlbum) {
    return (
      <AlbumDetailView
        album={activeAlbum}
        onBack={() => setActiveAlbum(null)}
        onToggleFavorite={onToggleFavorite}
        onDeleteAlbum={handleDelete}
        onNavigateToPerson={onNavigateToPerson}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {albums.length > 0 && (
        <div className="flex items-center gap-3 pl-1 pr-14 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
            <Grid3x3 className="h-3.5 w-3.5" />
            相册
          </span>
          <span className="text-fg-muted">{albums.length} 个相册</span>
          <Button
            size="small"
            onClick={openCreateAlbumWindow}
            icon={<Plus className="h-4 w-4" />}
          >
            新建相册
          </Button>
        </div>
      )}

      {/* Albums grid */}
      {albums.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              className="group cursor-pointer overflow-hidden rounded-xl border border-border-base bg-white/50 text-left transition-shadow hover:shadow-lg dark:bg-white/[0.03]"
              onClick={() => setActiveAlbum(album)}
            >
              <div className="aspect-[4/3] bg-fill-tertiary">
                {album.coverPhotoId ? (
                  <img
                    src={thumbUrl("photo", album.coverPhotoId, 400)}
                    alt={album.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Grid3x3 className="h-10 w-10 text-neutral-300 dark:text-neutral-600" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium text-fg-primary">
                  {album.name}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {album.photoCount} 张照片
                </p>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          className="min-h-80 py-0"
          description="暂无相册"
        >
          <Button
            onClick={openCreateAlbumWindow}
            icon={<Plus className="h-4 w-4" />}
          >
            新建相册
          </Button>
        </Empty>
      )}

    </div>
  );
}
