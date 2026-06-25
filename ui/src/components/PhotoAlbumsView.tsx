import { Button, Empty, Input, SegmentedControl, Spin } from "@tokimo/ui";
import { useRuntimeCtx, useWindowActions } from "@tokimo/sdk";
import {
  FolderOpen,
  Grid3x3,
  Plus,
  Search,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { PhotoAlbumOutput, PhotoOutput } from "../generated/rust-api";
import { api } from "../generated/rust-api";
import { thumbUrl } from "../lib/thumb";
import { registerBridge } from "../modal-bridge";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { PAGE_SIZE } from "./photo-utils";

type AlbumScope = "all" | "mine" | "shared";

const albumTypeMeta = {
  manual: { label: "手动", icon: Grid3x3 },
  person: { label: "人物", icon: UserRound },
  folder: { label: "文件夹", icon: FolderOpen },
  clip: { label: "标签", icon: Tag },
} as const;

function AlbumDetailView({
  album,
  onBack,
  onToggleFavorite,
  onDeleteAlbum,
  onShareAlbum,
  onNavigateToPerson,
}: {
  album: PhotoAlbumOutput;
  onBack: () => void;
  onToggleFavorite?: (photo: PhotoOutput) => void;
  onDeleteAlbum: (albumId: string) => void;
  onShareAlbum: (album: PhotoAlbumOutput) => void;
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
  const isDynamic = album.albumType !== "manual";
  const meta =
    albumTypeMeta[album.albumType as keyof typeof albumTypeMeta] ??
    albumTypeMeta.manual;
  const TypeIcon = meta.icon;

  return (
    <div className="space-y-4 px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            className="cursor-pointer text-sm text-fg-muted hover:text-fg-secondary"
            onClick={onBack}
          >
            ← 相册
          </button>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-fg-primary">
                {album.name}
              </h3>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-fill-secondary px-2 py-0.5 text-xs text-fg-secondary">
                <TypeIcon className="h-3 w-3" />
                {meta.label}
              </span>
            </div>
            <p className="text-sm text-fg-muted">
              {total} 张
              {isDynamic && album.sourceLabel
                ? ` · 自动更新自 ${album.sourceLabel}`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => onShareAlbum(album)}
            icon={<Share2 className="h-4 w-4" />}
          >
            分享
          </Button>
          <Button
            onClick={() => onDeleteAlbum(album.id)}
            icon={<Trash2 className="h-4 w-4" />}
          >
            删除
          </Button>
        </div>
      </div>

      {album.description && (
        <p className="text-sm text-fg-muted">{album.description}</p>
      )}

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
        <Empty
          description={
            isDynamic ? "这个自动相册暂时没有匹配照片" : "相册内暂无照片"
          }
        />
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

export function PhotoAlbumsView({
  appId,
  albums: initialAlbums,
  isLoading: initialLoading,
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
  const [scope, setScope] = useState<AlbumScope>("all");
  const [search, setSearch] = useState("");
  const [activeAlbum, setActiveAlbum] = useState<PhotoAlbumOutput | null>(null);

  const albumsQuery = api.photo.listPhotoAlbums.useQuery(
    { id: appId, scope },
    { enabled: !!appId },
  );
  const albums = albumsQuery.data ?? initialAlbums;
  const isLoading = albumsQuery.isLoading && initialLoading;

  const filteredAlbums = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return albums;
    return albums.filter((album) =>
      [album.name, album.description, album.sourceLabel]
        .filter(Boolean)
        .some((text) => text!.toLowerCase().includes(keyword)),
    );
  }, [albums, search]);

  const deleteMutation = api.photo.deletePhotoAlbum.useMutation({
    onSuccess: () => {
      setActiveAlbum(null);
      void albumsQuery.refetch();
      onRefresh();
    },
  });

  const openCreateAlbumWindow = useCallback(() => {
    const bridgeId = registerBridge({
      kind: "create-album",
      ctx,
      appId,
      onCreated: () => {
        void albumsQuery.refetch();
        onRefresh();
      },
    });
    openModalWindow({
      component: () => import("./CreateAlbumWindow"),
      title: "新建相册",
      width: 620,
      height: 620,
      metadata: { bridgeId },
    });
  }, [albumsQuery, appId, ctx, onRefresh, openModalWindow]);

  const openShareAlbumWindow = useCallback(
    (album: PhotoAlbumOutput) => {
      const bridgeId = registerBridge({
        kind: "share-album",
        ctx,
        albumId: album.id,
        albumName: album.name,
      });
      openModalWindow({
        component: () => import("./ShareAlbumWindow"),
        title: `分享相册 · ${album.name}`,
        width: 560,
        height: 520,
        metadata: { bridgeId },
      });
    },
    [ctx, openModalWindow],
  );

  const handleDelete = useCallback(
    (albumId: string) => {
      deleteMutation.mutate({ albumId });
    },
    [deleteMutation],
  );

  if (activeAlbum) {
    return (
      <AlbumDetailView
        album={activeAlbum}
        onBack={() => setActiveAlbum(null)}
        onToggleFavorite={onToggleFavorite}
        onDeleteAlbum={handleDelete}
        onShareAlbum={openShareAlbumWindow}
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
    <div className="flex flex-col gap-4 px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
            <Grid3x3 className="h-4 w-4" />
            相册
          </span>
          <span className="text-sm text-fg-muted">
            {filteredAlbums.length} / {albums.length}
          </span>
        </div>
        <Button
          size="small"
          onClick={openCreateAlbumWindow}
          icon={<Plus className="h-4 w-4" />}
        >
          新建相册
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={scope}
          onChange={(value) => setScope(value as AlbumScope)}
          options={[
            { label: "全部", value: "all" },
            { label: "我的相册", value: "mine" },
            { label: "他人分享", value: "shared" },
          ]}
        />
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索相册"
            className="w-full pl-9"
          />
        </div>
      </div>

      {filteredAlbums.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {filteredAlbums.map((album) => (
            <AlbumCard
              key={album.id}
              album={album}
              onClick={() => setActiveAlbum(album)}
            />
          ))}
        </div>
      ) : (
        <Empty className="min-h-80 py-0" description="暂无相册">
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

function AlbumCard({
  album,
  onClick,
}: {
  album: PhotoAlbumOutput;
  onClick: () => void;
}) {
  const meta =
    albumTypeMeta[album.albumType as keyof typeof albumTypeMeta] ??
    albumTypeMeta.manual;
  const TypeIcon = meta.icon;
  const isDynamic = album.albumType !== "manual";

  return (
    <button
      type="button"
      className="group cursor-pointer overflow-hidden rounded-lg border border-base bg-surface-raised text-left transition-shadow hover:shadow-lg"
      onClick={onClick}
    >
      <div className="relative aspect-[4/3] bg-fill-tertiary">
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
            {isDynamic ? (
              <Sparkles className="h-10 w-10 text-fg-muted" />
            ) : (
              <Grid3x3 className="h-10 w-10 text-fg-muted" />
            )}
          </div>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-surface-overlay/90 px-2 py-1 text-xs text-fg-secondary shadow-sm backdrop-blur-sm">
          <TypeIcon className="h-3 w-3" />
          {meta.label}
        </span>
      </div>
      <div className="space-y-1 p-3">
        <p className="truncate text-sm font-medium text-fg-primary">
          {album.name}
        </p>
        <p className="text-xs text-fg-muted">
          {album.photoCount} 张照片
          {album.sourceLabel ? ` · ${album.sourceLabel}` : ""}
        </p>
      </div>
    </button>
  );
}
