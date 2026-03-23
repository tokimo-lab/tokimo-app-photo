import {
  Button,
  Empty,
  ReloadOutlined,
  Spin,
  SyncOutlined,
  Tag,
} from "@tokiomo/components";
import {
  Calendar,
  ChevronRight,
  FolderOpen,
  Grid3x3,
  Heart,
  ImageIcon,
  Star,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { TopBarSearch } from "../../components/dashboard/TopBarSearch";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { useMessage, useTopBar } from "../../hooks";

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 80;
const THUMB_WIDTH = 320;

type TabKey = "timeline" | "folders" | "favorites" | "albums";

const tabs: { key: TabKey; label: string; icon: typeof Calendar }[] = [
  { key: "timeline", label: "时间线", icon: Calendar },
  { key: "folders", label: "文件夹", icon: FolderOpen },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "albums", label: "相册", icon: Grid3x3 },
];

// ── Main Page ────────────────────────────────────────────────────────────────
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

  const [_syncModalOpen, _setSyncModalOpen] = useState(false);
  const [_syncClearData, _setSyncClearData] = useState(false);

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
      {/* Header + Tabs */}
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
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spin />
        </div>
      ) : tab === "timeline" ? (
        <PhotoTimeline photos={photos} />
      ) : tab === "folders" ? (
        <PhotoFoldersView libraryId={id} />
      ) : tab === "favorites" ? (
        favoritePhotos.length > 0 ? (
          <PhotoTimeline photos={favoritePhotos} />
        ) : (
          <Empty description="暂无收藏照片，点击照片上的 ♥ 收藏" />
        )
      ) : (
        <PhotoAlbumsGrid albums={albums} />
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

// ── Timeline View ────────────────────────────────────────────────────────────

function groupPhotosByDate(photos: PhotoOutput[]) {
  const groups: { date: string; label: string; photos: PhotoOutput[] }[] = [];
  const map = new Map<string, PhotoOutput[]>();

  for (const photo of photos) {
    const dateStr = photo.takenAt ? photo.takenAt.slice(0, 10) : "未知日期";
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr)!.push(photo);
  }

  for (const [date, items] of map) {
    const d = new Date(date);
    const label =
      date === "未知日期"
        ? date
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    groups.push({ date, label, photos: items });
  }

  return groups;
}

function PhotoTimeline({ photos }: { photos: PhotoOutput[] }) {
  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  return (
    <>
      <div className="space-y-6">
        {groups.map((group) => (
          <div
            key={group.date}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "auto 200px",
            }}
          >
            {/* Date header */}
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 py-1">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {group.label}
              </h3>
              <span className="text-xs text-neutral-400">
                {group.photos.length} 张
              </span>
            </div>

            {/* Photo grid */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
              {group.photos.map((photo) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  onClick={setSelectedPhoto}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          allPhotos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
        />
      )}
    </>
  );
}

// ── Photo Thumbnail ──────────────────────────────────────────────────────────

const PhotoThumbnail = memo(function PhotoThumbnail({
  photo,
  onClick,
}: {
  photo: PhotoOutput;
  onClick: (photo: PhotoOutput) => void;
}) {
  const src = photo.sourceId
    ? `/api/photos/${photo.id}/thumbnail?w=${THUMB_WIDTH}`
    : undefined;
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <button
      type="button"
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800"
      onClick={() => onClick(photo)}
    >
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={photo.title || photo.filename}
          className={`h-full w-full object-cover transition-opacity duration-200 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
        </div>
      )}

      {/* Favorite badge */}
      {photo.isFavorite && (
        <div className="absolute right-1 top-1">
          <Heart className="h-4 w-4 fill-red-500 text-red-500 drop-shadow" />
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="truncate text-xs text-white">{photo.filename}</p>
      </div>
    </button>
  );
});

// ── Photo Folders View ───────────────────────────────────────────────────────

function PhotoFoldersView({ libraryId }: { libraryId: string }) {
  const [currentPath, setCurrentPath] = useState("/");
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  const foldersQuery = api.mediaLibrary.listPhotoFolders.useQuery(
    { libraryId, path: currentPath },
    { enabled: !!libraryId },
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
        />
      )}
    </>
  );
}

// ── Photo Albums Grid ────────────────────────────────────────────────────────

function PhotoAlbumsGrid({
  albums,
}: {
  albums: {
    id: string;
    name: string;
    description: string | null;
    photoCount: number;
    coverPhotoId: string | null;
  }[];
}) {
  if (albums.length === 0) {
    return <Empty description="暂无相册" />;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
      {albums.map((album) => (
        <div
          key={album.id}
          className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--glass-border)] bg-white/50 transition-shadow hover:shadow-lg dark:bg-white/[0.03]"
        >
          <div className="aspect-[4/3] bg-neutral-100 dark:bg-neutral-800">
            {album.coverPhotoId ? (
              <img
                src={`/api/photos/${album.coverPhotoId}/thumbnail?w=400`}
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
            <p className="mt-0.5 text-xs text-neutral-500">
              {album.photoCount} 张照片
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Photo Lightbox ───────────────────────────────────────────────────────────

function PhotoLightbox({
  photo,
  allPhotos,
  onClose,
  onNavigate,
}: {
  photo: PhotoOutput;
  allPhotos: PhotoOutput[];
  onClose: () => void;
  onNavigate: (p: PhotoOutput) => void;
}) {
  const idx = allPhotos.findIndex((p) => p.id === photo.id);
  const hasPrev = idx > 0;
  const hasNext = idx < allPhotos.length - 1;
  const [showInfo, setShowInfo] = useState(false);

  const detailQuery = api.mediaLibrary.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: true },
  );
  const detail = detailQuery.data;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(allPhotos[idx - 1]);
      if (e.key === "ArrowRight" && hasNext) onNavigate(allPhotos[idx + 1]);
      if (e.key === "i") setShowInfo((v) => !v);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [idx, hasPrev, hasNext, allPhotos, onClose, onNavigate]);

  const src = photo.sourceId ? `/api/photos/${photo.id}/image` : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90">
      {/* Close button */}
      <button
        type="button"
        className="absolute right-4 top-4 z-10 cursor-pointer rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
        onClick={onClose}
      >
        ✕
      </button>

      {/* Info toggle */}
      <button
        type="button"
        className="absolute right-14 top-4 z-10 cursor-pointer rounded-full bg-black/50 px-3 py-2 text-xs text-white transition-colors hover:bg-black/70"
        onClick={() => setShowInfo((v) => !v)}
      >
        ℹ️ 详情
      </button>

      {/* Previous */}
      {hasPrev && (
        <button
          type="button"
          className="absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
          onClick={() => onNavigate(allPhotos[idx - 1])}
        >
          ‹
        </button>
      )}

      {/* Next */}
      {hasNext && (
        <button
          type="button"
          className="absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/50 p-3 text-2xl text-white transition-colors hover:bg-black/70"
          onClick={() => onNavigate(allPhotos[idx + 1])}
        >
          ›
        </button>
      )}

      {/* Image */}
      <div className="flex h-full w-full items-center justify-center p-12">
        {src ? (
          <img
            src={src}
            alt={photo.title || photo.filename}
            className="max-h-full max-w-full select-none object-contain"
            draggable={false}
          />
        ) : (
          <div className="text-neutral-400">无法加载图片</div>
        )}
      </div>

      {/* Info panel */}
      {showInfo && detail && (
        <div className="absolute bottom-0 right-0 top-0 w-80 overflow-y-auto border-l border-white/10 bg-black/80 p-6 text-sm text-white backdrop-blur">
          <h3 className="mb-4 text-base font-semibold">
            {detail.title || detail.filename}
          </h3>
          <div className="space-y-3">
            {detail.takenAt && (
              <InfoRow
                label="拍摄时间"
                value={new Date(detail.takenAt).toLocaleString()}
              />
            )}
            {detail.cameraMake && (
              <InfoRow
                label="相机"
                value={`${detail.cameraMake} ${detail.cameraModel || ""}`}
              />
            )}
            {detail.lensModel && (
              <InfoRow label="镜头" value={detail.lensModel} />
            )}
            {detail.focalLength && (
              <InfoRow label="焦距" value={`${detail.focalLength}mm`} />
            )}
            {detail.aperture && (
              <InfoRow label="光圈" value={`f/${detail.aperture}`} />
            )}
            {detail.shutterSpeed && (
              <InfoRow label="快门" value={detail.shutterSpeed} />
            )}
            {detail.iso && <InfoRow label="ISO" value={String(detail.iso)} />}
            {detail.width && detail.height && (
              <InfoRow
                label="分辨率"
                value={`${detail.width} × ${detail.height}`}
              />
            )}
            {detail.fileSize && (
              <InfoRow label="文件大小" value={formatBytes(detail.fileSize)} />
            )}
            {detail.locationName && (
              <InfoRow label="位置" value={detail.locationName} />
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/70">
        {idx + 1} / {allPhotos.length} — {photo.filename}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/50">{label}</span>
      <p className="text-white/90">{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
