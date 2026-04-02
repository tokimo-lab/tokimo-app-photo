import { Button, Empty, Spin } from "@tokiomo/components";
import { Grid3x3, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { PhotoAlbumOutput, PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { PAGE_SIZE } from "./photo-utils";

// ── Create Album Dialog ──────────────────────────────────────────────────────

function CreateAlbumDialog({
  onClose,
  onCreate,
  isPending,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-[var(--glass-border)] bg-surface-elevated p-6 shadow-2xl ">
        <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          新建相册
        </h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="album-name"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              名称
            </label>
            <input
              id="album-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border-base bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500  dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="输入相册名称"
            />
          </div>
          <div>
            <label
              htmlFor="album-desc"
              className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              描述（可选）
            </label>
            <textarea
              id="album-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-border-base bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500  dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="描述一下这个相册"
              rows={3}
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button onClick={onClose} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={() => onCreate(name.trim(), description.trim())}
            disabled={!name.trim() || isPending}
            loading={isPending}
          >
            创建
          </Button>
        </div>
      </div>
    </div>
  );
}

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

  const photosQuery = api.app.listAlbumPhotos.useQuery(
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
            className="cursor-pointer text-sm text-fg-muted hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            onClick={onBack}
          >
            ← 返回
          </button>
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
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
  const [showCreate, setShowCreate] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState<PhotoAlbumOutput | null>(null);

  const createMutation = api.app.createPhotoAlbum.useMutation({
    onSuccess: () => {
      setShowCreate(false);
      onRefresh();
    },
  });

  const deleteMutation = api.app.deletePhotoAlbum.useMutation({
    onSuccess: () => {
      setActiveAlbum(null);
      onRefresh();
    },
  });

  const handleCreate = useCallback(
    (name: string, description: string) => {
      createMutation.mutate({
        appId,
        name,
        description: description || undefined,
      });
    },
    [appId, createMutation.mutate],
  );

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
    <>
      {/* Create album button */}
      <div className="flex justify-end">
        <Button
          onClick={() => setShowCreate(true)}
          icon={<Plus className="h-4 w-4" />}
        >
          新建相册
        </Button>
      </div>

      {/* Albums grid */}
      {albums.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {albums.map((album) => (
            <button
              key={album.id}
              type="button"
              className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--glass-border)] bg-white/50 text-left transition-shadow hover:shadow-lg dark:bg-white/[0.03]"
              onClick={() => setActiveAlbum(album)}
            >
              <div className="aspect-[4/3] bg-fill-tertiary">
                {album.coverPhotoId ? (
                  <img
                    src={`/api/apps/photo/${album.coverPhotoId}/thumbnail?w=400`}
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
                <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
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
        <Empty description="暂无相册，点击「新建相册」创建" />
      )}

      {/* Create album dialog */}
      {showCreate && (
        <CreateAlbumDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          isPending={createMutation.isPending}
        />
      )}
    </>
  );
}
