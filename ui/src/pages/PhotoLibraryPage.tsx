import {
  Button,
  Empty,
  ReloadOutlined,
  Spin,
  SyncOutlined,
  Tag,
} from "@tokiomo/components";
import { Calendar, FolderOpen, Grid3x3, Star } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { TopBarSearch } from "../../components/dashboard/TopBarSearch";
import { PhotoAlbumsView } from "../../components/photo/PhotoAlbumsView";
import { PhotoFoldersView } from "../../components/photo/PhotoFoldersView";
import { PhotoTimeline } from "../../components/photo/PhotoTimeline";
import { PAGE_SIZE } from "../../components/photo/photo-utils";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { useMessage, useTopBar } from "../../hooks";

type TabKey = "timeline" | "folders" | "favorites" | "albums";

const tabs: { key: TabKey; label: string; icon: typeof Calendar }[] = [
  { key: "timeline", label: "时间线", icon: Calendar },
  { key: "folders", label: "文件夹", icon: FolderOpen },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "albums", label: "相册", icon: Grid3x3 },
];

export default function PhotoLibraryPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const message = useMessage();

  const tab = (searchParams.get("tab") as TabKey) || "timeline";
  const setTab = useCallback(
    (t: TabKey) => {
      setSearchParams({ tab: t }, { replace: true });
    },
    [setSearchParams],
  );

  const [page, setPage] = useState(1);
  const [search, _setSearch] = useState("");

  const libraryQuery = api.mediaLibrary.getById.useQuery(
    { id: id! },
    { enabled: !!id },
  );

  const photosQuery = api.mediaLibrary.listPhotos.useQuery(
    {
      libraryId: id!,
      page,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      search: search || undefined,
    },
    { enabled: !!id && tab === "timeline" },
  );

  const favoritesQuery = api.mediaLibrary.listPhotos.useQuery(
    {
      libraryId: id!,
      page,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      favoritesOnly: true,
    },
    { enabled: !!id && tab === "favorites" },
  );

  const albumsQuery = api.mediaLibrary.listPhotoAlbums.useQuery(
    { libraryId: id! },
    { enabled: !!id && tab === "albums" },
  );

  const syncMutation = api.mediaLibrary.sync.useMutation({
    onSuccess: () => {
      message.success("同步已开始");
      void photosQuery.refetch();
    },
    onError: (e) => message.error(e.message || "同步失败"),
  });

  const total = photosQuery.data?.total ?? 0;
  const photos = photosQuery.data?.items ?? [];
  const favoritePhotos = favoritesQuery.data?.items ?? [];
  const favoriteTotal = favoritesQuery.data?.total ?? 0;
  const albums = albumsQuery.data ?? [];

  const isLoading =
    tab === "timeline"
      ? photosQuery.isLoading
      : tab === "favorites"
        ? favoritesQuery.isLoading
        : tab === "albums"
          ? albumsQuery.isLoading
          : false;

  // ── Favorite toggle ─────────────────────────────────────────────────────
  const toggleFavMutation = api.mediaLibrary.togglePhotoFavorite.useMutation({
    onSuccess: () => {
      void photosQuery.refetch();
      void favoritesQuery.refetch();
    },
  });

  const handleToggleFavorite = useCallback(
    (photo: PhotoOutput) => {
      toggleFavMutation.mutate({ photoId: photo.id });
    },
    [toggleFavMutation.mutate],
  );

  // ── TopBar ──────────────────────────────────────────────────────────────
  const refetchPhotos = useCallback(
    () => void photosQuery.refetch(),
    [photosQuery.refetch],
  );
  const doSync = useCallback(() => {
    if (!id) return;
    syncMutation.mutate({ id, clearData: false });
  }, [id, syncMutation.mutate]);

  const isRefetching = photosQuery.isRefetching;
  const isSyncing = syncMutation.isPending;

  useTopBar({
    left: useMemo(() => {
      if (!id) return undefined;
      return (
        <TopBarSearch
          libraryId={id}
          isTv={false}
          onSelect={() => {}}
          recentItems={[]}
        />
      );
    }, [id]),
    right: useMemo(() => {
      if (!id) return undefined;
      return (
        <>
          <Button
            icon={<ReloadOutlined />}
            onClick={refetchPhotos}
            loading={isRefetching}
          >
            刷新
          </Button>
          <Button icon={<SyncOutlined />} onClick={doSync} loading={isSyncing}>
            同步
          </Button>
        </>
      );
    }, [id, refetchPhotos, isRefetching, doSync, isSyncing]),
  });

  if (!id) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
            {libraryQuery.data?.name ?? "相册"}
          </h2>
          {tab === "timeline" && total > 0 && <Tag>{total} 张</Tag>}
          {tab === "favorites" && favoriteTotal > 0 && (
            <Tag>{favoriteTotal} 张</Tag>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-[var(--glass-border)] bg-neutral-100 p-1 dark:bg-neutral-800">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              }`}
              onClick={() => setTab(t.key)}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {isLoading && tab !== "albums" ? (
        <div className="flex h-64 items-center justify-center">
          <Spin />
        </div>
      ) : tab === "timeline" ? (
        <PhotoTimeline
          photos={photos}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : tab === "folders" ? (
        <PhotoFoldersView
          libraryId={id}
          onToggleFavorite={handleToggleFavorite}
        />
      ) : tab === "favorites" ? (
        favoritePhotos.length > 0 ? (
          <PhotoTimeline
            photos={favoritePhotos}
            onToggleFavorite={handleToggleFavorite}
          />
        ) : (
          <Empty description="暂无收藏照片，点击照片上的 ♥ 收藏" />
        )
      ) : (
        <PhotoAlbumsView
          libraryId={id}
          albums={albums}
          isLoading={albumsQuery.isLoading}
          onToggleFavorite={handleToggleFavorite}
          onRefresh={() => void albumsQuery.refetch()}
        />
      )}

      {/* Load more */}
      {(tab === "timeline" || tab === "favorites") &&
        !isLoading &&
        (() => {
          const items = tab === "favorites" ? favoritePhotos : photos;
          const count = tab === "favorites" ? favoriteTotal : total;
          return (
            items.length > 0 &&
            items.length < count && (
              <div className="flex justify-center py-4">
                <Button onClick={() => setPage((p) => p + 1)}>加载更多</Button>
              </div>
            )
          );
        })()}

      {tab === "timeline" && !isLoading && photos.length === 0 && (
        <Empty description="暂无照片，请先同步媒体库" />
      )}
    </div>
  );
}
