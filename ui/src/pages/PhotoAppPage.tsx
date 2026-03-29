import { Button, Checkbox, Empty, Modal, Spin, Tag } from "@tokiomo/components";
import {
  Calendar,
  FolderOpen,
  FolderSync,
  Grid3x3,
  LayoutGrid,
  MapPin,
  MousePointerClick,
  RefreshCw,
  ScanText,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MenuBarConfig } from "@/system";
import { useMenuBar, useMessage, useWindowNav } from "@/system";
import { AlbumPickerDialog } from "../../components/photo/AlbumPickerDialog";
import { PhotoAlbumsView } from "../../components/photo/PhotoAlbumsView";
import { PhotoFoldersView } from "../../components/photo/PhotoFoldersView";
import { PhotoLocationTab } from "../../components/photo/PhotoLocationTab";
import { PhotoPeopleView } from "../../components/photo/PhotoPeopleView";
import { PhotoSelectionBar } from "../../components/photo/PhotoSelectionBar";
import {
  loadSavedSizeIndex,
  PHOTO_SIZE_LEVELS,
  saveSizeIndex,
} from "../../components/photo/PhotoSizeSlider";
import { PhotoTimeline } from "../../components/photo/PhotoTimeline";
import { PAGE_SIZE } from "../../components/photo/photo-utils";
import {
  clearViewerPhotos,
  setViewerPhotos,
} from "../../components/photo/photo-viewer-store";
import { SyncProgressOverlay } from "../../components/photo/SyncProgressOverlay";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";

type TabKey =
  | "timeline"
  | "folders"
  | "favorites"
  | "locations"
  | "people"
  | "albums"
  | "trash";

const tabs: { key: TabKey; label: string; icon: typeof Calendar }[] = [
  { key: "timeline", label: "时间线", icon: Calendar },
  { key: "folders", label: "文件夹", icon: FolderOpen },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "locations", label: "地点", icon: MapPin },
  { key: "people", label: "人物", icon: Users },
  { key: "albums", label: "相册", icon: Grid3x3 },
  { key: "trash", label: "回收站", icon: Trash2 },
];

export default function PhotoAppPage() {
  const { params } = useWindowNav();
  const id = params.appId as string | undefined;
  const message = useMessage();
  const rootRef = useRef<HTMLDivElement>(null);

  const [tab, setTabRaw] = useState<TabKey>(
    (params.tab as TabKey) || "timeline",
  );
  const setTab = useCallback((t: TabKey) => {
    setTabRaw(t);
    setSelectedIds(new Set());
    setIsSelecting(false);
    setSearchQuery("");
    // Don't reset pagination — each tab keeps its scroll position & loaded pages
  }, []);

  // ── Grid size state ──────────────────────────────────────────────────
  const [sizeIndex, setSizeIndex] = useState(loadSavedSizeIndex);
  const targetRowHeight = PHOTO_SIZE_LEVELS[sizeIndex].height;

  // ── Navigate to person (from lightbox face click) ──────────────────
  const [navigateToPersonId, setNavigateToPersonId] = useState<string | null>(
    null,
  );

  const handleNavigateToPerson = useCallback(
    (personId: string) => {
      setNavigateToPersonId(personId);
      setTab("people");
    },
    [setTab],
  );

  const handleNavigateToPersonHandled = useCallback(() => {
    setNavigateToPersonId(null);
  }, []);

  // Hide scrollbar on the scroll parent (photo uses timeline scrubber instead)
  useEffect(() => {
    let el = rootRef.current?.parentElement ?? null;
    while (el) {
      const ov = getComputedStyle(el).overflowY;
      if (ov === "auto" || ov === "scroll") {
        el.classList.add("hide-scrollbar");
        const target = el;
        return () => target.classList.remove("hide-scrollbar");
      }
      el = el.parentElement;
    }
  }, []);

  // ── Search state ─────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchMode] = useState<"filename" | "clip">("filename");

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      // Reset pagination when search changes
      setTimelinePage(1);
      accTimelineRef.current = [];
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  // ── Selection state ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);

  const handleSelect = useCallback((photo: PhotoOutput) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photo.id)) {
        next.delete(photo.id);
      } else {
        next.add(photo.id);
      }
      if (next.size > 0) {
        setIsSelecting(true);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }, []);

  const toggleSelectMode = useCallback(() => {
    if (isSelecting) {
      clearSelection();
    } else {
      setIsSelecting(true);
    }
  }, [isSelecting, clearSelection]);

  // ── Infinite scroll pagination ─────────────────────────────────────────
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineBeforeDate, setTimelineBeforeDate] = useState<
    string | undefined
  >();
  const [favPage, setFavPage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [favLoadingMore, setFavLoadingMore] = useState(false);
  const [trashLoadingMore, setTrashLoadingMore] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingToAlbum, setIsAddingToAlbum] = useState(false);
  const accTimelineRef = useRef<PhotoOutput[]>([]);
  const accFavRef = useRef<PhotoOutput[]>([]);
  const accTrashRef = useRef<PhotoOutput[]>([]);

  // ── Queries ────────────────────────────────────────────────────────────
  // NOTE: libraryQuery was removed — it was defined but never consumed,
  // causing unnecessary re-renders from query state transitions.

  const photosQuery = api.app.listPhotos.useQuery(
    {
      appId: id!,
      page: timelinePage,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      search: debouncedSearch || undefined,
      beforeDate: timelineBeforeDate,
    },
    { enabled: !!id && tab === "timeline" },
  );

  const favoritesQuery = api.app.listPhotos.useQuery(
    {
      appId: id!,
      page: favPage,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      favoritesOnly: true,
    },
    { enabled: !!id && tab === "favorites" },
  );

  const albumsQuery = api.app.listPhotoAlbums.useQuery(
    { appId: id! },
    { enabled: !!id && tab === "albums" },
  );

  const trashedQuery = api.app.listTrashedPhotos.useQuery(
    { appId: id!, page: trashPage, pageSize: PAGE_SIZE },
    { enabled: !!id && tab === "trash" },
  );

  // ── OCR text search ──────────────────────────────────────────────────
  const ocrQuery = api.photoSettings.ocrSearch.useQuery(
    { appId: id!, q: debouncedSearch! },
    {
      enabled:
        !!id &&
        !!debouncedSearch &&
        debouncedSearch.length >= 2 &&
        tab === "timeline",
    },
  );

  const ocrResults = ocrQuery.data ?? [];
  const [ocrFilterActive, setOcrFilterActive] = useState(false);
  const [ocrDismissed, setOcrDismissed] = useState(false);

  // ── CLIP text-to-image search ─────────────────────────────────────────
  const clipQuery = api.photoSettings.clipSearch.useQuery(
    { appId: id!, q: debouncedSearch },
    {
      enabled:
        !!id &&
        searchMode === "clip" &&
        !!debouncedSearch &&
        debouncedSearch.length >= 2 &&
        tab === "timeline",
    },
  );
  const clipResults = clipQuery.data ?? [];

  // Reset OCR filter state when search changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on search change
  useEffect(() => {
    setOcrFilterActive(false);
    setOcrDismissed(false);
  }, [debouncedSearch]);

  const ocrPhotoIds = useMemo(
    () => new Set(ocrResults.map((r) => r.photoId)),
    [ocrResults],
  );

  // Accumulate timeline photos across pages
  const timelineTotal = photosQuery.data?.total ?? 0;
  useEffect(() => {
    if (!photosQuery.data?.items) return;
    setTimelineLoadingMore(false);
    if (timelinePage === 1) {
      accTimelineRef.current = photosQuery.data.items;
    } else {
      const ids = new Set(accTimelineRef.current.map((p) => p.id));
      const newItems = photosQuery.data.items.filter((p) => !ids.has(p.id));
      accTimelineRef.current = [...accTimelineRef.current, ...newItems];
    }
  }, [photosQuery.data, timelinePage]);

  const allTimelinePhotosRaw = useMemo(
    () =>
      accTimelineRef.current.length > 0
        ? accTimelineRef.current
        : (photosQuery.data?.items ?? []),
    [photosQuery.data?.items],
  );

  const allTimelinePhotos = useMemo(
    () =>
      ocrFilterActive
        ? allTimelinePhotosRaw.filter((p) => ocrPhotoIds.has(p.id))
        : allTimelinePhotosRaw,
    [ocrFilterActive, allTimelinePhotosRaw, ocrPhotoIds],
  );
  const timelineHasMore =
    !ocrFilterActive && allTimelinePhotos.length < timelineTotal;

  // Sync photo list to viewer store for windowed photo viewer navigation
  useEffect(() => {
    if (id) setViewerPhotos(id, allTimelinePhotos);
    return () => {
      if (id) clearViewerPhotos(id);
    };
  }, [id, allTimelinePhotos]);

  // Accumulate favorites across pages
  const favTotal = favoritesQuery.data?.total ?? 0;
  useEffect(() => {
    if (!favoritesQuery.data?.items) return;
    setFavLoadingMore(false);
    if (favPage === 1) {
      accFavRef.current = favoritesQuery.data.items;
    } else {
      const ids = new Set(accFavRef.current.map((p) => p.id));
      const newItems = favoritesQuery.data.items.filter((p) => !ids.has(p.id));
      accFavRef.current = [...accFavRef.current, ...newItems];
    }
  }, [favoritesQuery.data, favPage]);

  const allFavPhotos = useMemo(
    () =>
      accFavRef.current.length > 0
        ? accFavRef.current
        : (favoritesQuery.data?.items ?? []),
    [favoritesQuery.data?.items],
  );
  const favHasMore = allFavPhotos.length < favTotal;

  // Accumulate trash photos across pages
  const trashTotal = trashedQuery.data?.total ?? 0;
  useEffect(() => {
    if (!trashedQuery.data?.items) return;
    setTrashLoadingMore(false);
    if (trashPage === 1) {
      accTrashRef.current = trashedQuery.data.items;
    } else {
      const ids = new Set(accTrashRef.current.map((p) => p.id));
      const newItems = trashedQuery.data.items.filter((p) => !ids.has(p.id));
      accTrashRef.current = [...accTrashRef.current, ...newItems];
    }
  }, [trashedQuery.data, trashPage]);

  const allTrashPhotos = useMemo(
    () =>
      accTrashRef.current.length > 0
        ? accTrashRef.current
        : (trashedQuery.data?.items ?? []),
    [trashedQuery.data?.items],
  );
  const trashHasMore = allTrashPhotos.length < trashTotal;

  const albums = albumsQuery.data ?? [];

  const isLoading =
    tab === "timeline"
      ? !photosQuery.data && timelinePage === 1
      : tab === "favorites"
        ? !favoritesQuery.data && favPage === 1
        : tab === "albums"
          ? !albumsQuery.data
          : tab === "trash"
            ? !trashedQuery.data && trashPage === 1
            : false;

  // CLIP mode is active when we have a valid search in clip mode on timeline tab
  const isClipActive =
    searchMode === "clip" && debouncedSearch.length >= 2 && tab === "timeline";

  // Stable refs to avoid re-render cascades from useCallback deps
  const photosRefetchRef = useRef(photosQuery.refetch);
  photosRefetchRef.current = photosQuery.refetch;
  const favRefetchRef = useRef(favoritesQuery.refetch);
  favRefetchRef.current = favoritesQuery.refetch;
  const trashedRefetchRef = useRef(trashedQuery.refetch);
  trashedRefetchRef.current = trashedQuery.refetch;
  const messageRef = useRef(message);
  messageRef.current = message;

  const syncMutation = api.app.sync.useMutation({
    onMutate: () => setIsSyncing(true),
    onSettled: () => setIsSyncing(false),
    onSuccess: () => {
      message.success("同步已开始");
      setTimelinePage(1);
      accTimelineRef.current = [];
      void photosQuery.refetch();
    },
    onError: (e) => message.error(e.message || "同步失败"),
  });

  // ── Favorite toggle ─────────────────────────────────────────────────────
  const toggleFavMutation = api.app.togglePhotoFavorite.useMutation({
    onSuccess: () => {
      void photosQuery.refetch();
      void favoritesQuery.refetch();
    },
  });
  const toggleFavRef = useRef(toggleFavMutation.mutate);
  toggleFavRef.current = toggleFavMutation.mutate;

  const handleToggleFavorite = useCallback((photo: PhotoOutput) => {
    toggleFavRef.current({ photoId: photo.id });
  }, []);

  // ── Batch operations ──────────────────────────────────────────────────
  const batchFavMutation = api.app.batchFavorite.useMutation({
    onSuccess: (data) => {
      message.success(`已更新 ${data.updated} 张照片`);
      clearSelection();
      void photosQuery.refetch();
      void favoritesQuery.refetch();
    },
    onError: (e) => message.error(e.message || "操作失败"),
  });

  const addToAlbumMutation = api.app.addPhotosToAlbum.useMutation({
    onMutate: () => setIsAddingToAlbum(true),
    onSettled: () => setIsAddingToAlbum(false),
    onSuccess: () => {
      message.success("已添加到相册");
      clearSelection();
      setShowAlbumPicker(false);
      void albumsQuery.refetch();
    },
    onError: (e) => message.error(e.message || "操作失败"),
  });

  const handleBatchFavorite = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchFavMutation.mutate({
      appId: id,
      photoIds: [...selectedIds],
      favorite: true,
    });
  }, [id, selectedIds, batchFavMutation.mutate]);

  const handleBatchUnfavorite = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchFavMutation.mutate({
      appId: id,
      photoIds: [...selectedIds],
      favorite: false,
    });
  }, [id, selectedIds, batchFavMutation.mutate]);

  const handleAddToAlbum = useCallback(
    (albumId: string) => {
      addToAlbumMutation.mutate({
        albumId,
        photoIds: [...selectedIds],
      });
    },
    [selectedIds, addToAlbumMutation.mutate],
  );

  // ── Batch hide mutation ────────────────────────────────────────
  const batchHideMutation = api.app.batchHide.useMutation();
  const batchHideMutateRef = useRef(batchHideMutation.mutate);
  batchHideMutateRef.current = batchHideMutation.mutate;

  const handleBatchHide = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchHideMutateRef.current(
      { appId: id, photoIds: [...selectedIds], hidden: true },
      {
        onSuccess: () => {
          messageRef.current.success(`已隐藏 ${selectedIds.size} 张照片`);
          setSelectedIds(new Set());
          setIsSelecting(false);
          photosRefetchRef.current();
          favRefetchRef.current();
        },
      },
    );
  }, [id, selectedIds]);

  // ── Trash mutation ────────────────────────────────────────────
  const trashMutation = api.app.trashPhotos.useMutation();
  const trashMutateRef = useRef(trashMutation.mutate);
  trashMutateRef.current = trashMutation.mutate;

  const handleTrash = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    if (!window.confirm(`确定要将 ${selectedIds.size} 张照片移到回收站吗？`))
      return;
    trashMutateRef.current(
      { appId: id, photoIds: [...selectedIds] },
      {
        onSuccess: () => {
          messageRef.current.success(
            `已将 ${selectedIds.size} 张照片移到回收站`,
          );
          setSelectedIds(new Set());
          setIsSelecting(false);
          photosRefetchRef.current();
          favRefetchRef.current();
        },
      },
    );
  }, [id, selectedIds]);

  // ── Trash operations ──────────────────────────────────────────────────
  const restoreMutation = api.app.restorePhotos.useMutation({
    onMutate: () => setIsRestoring(true),
    onSettled: () => setIsRestoring(false),
    onSuccess: (data) => {
      message.success(`已恢复 ${data.restored} 张照片`);
      clearSelection();
      setTrashPage(1);
      accTrashRef.current = [];
      void trashedQuery.refetch();
      void photosQuery.refetch();
    },
    onError: (e) => message.error(e.message || "恢复失败"),
  });

  const permanentDeleteMutation = api.app.permanentDelete.useMutation({
    onMutate: () => setIsDeleting(true),
    onSettled: () => setIsDeleting(false),
    onSuccess: (data) => {
      message.success(`已永久删除 ${data.deleted} 张照片`);
      clearSelection();
      setTrashPage(1);
      accTrashRef.current = [];
      void trashedQuery.refetch();
    },
    onError: (e) => message.error(e.message || "删除失败"),
  });

  const handleRestore = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    restoreMutation.mutate({ appId: id, photoIds: [...selectedIds] });
  }, [id, selectedIds, restoreMutation.mutate]);

  const handlePermanentDelete = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    if (!window.confirm("永久删除选中的照片？此操作不可恢复！")) return;
    permanentDeleteMutation.mutate({
      appId: id,
      photoIds: [...selectedIds],
    });
  }, [id, selectedIds, permanentDeleteMutation.mutate]);

  // ── Infinite scroll callbacks ─────────────────────────────────────────
  const loadMoreTimeline = useCallback(() => {
    setTimelineLoadingMore(true);
    setTimelinePage((p) => p + 1);
  }, []);

  // Seek to a specific date — resets pagination with beforeDate filter
  const seekToDate = useCallback((datePrefix: string) => {
    // Convert year-month prefix like "2022-06" to end-of-month date
    const parts = datePrefix.split("-");
    let beforeDate: string;
    if (parts.length >= 2) {
      const y = Number.parseInt(parts[0], 10);
      const m = Number.parseInt(parts[1], 10);
      // Last day of the month
      const lastDay = new Date(y, m, 0).getDate();
      beforeDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    } else {
      // Year only — use Dec 31
      beforeDate = `${parts[0]}-12-31`;
    }
    accTimelineRef.current = [];
    setTimelinePage(1);
    setTimelineBeforeDate(beforeDate);
  }, []);

  const loadMoreFav = useCallback(() => {
    setFavLoadingMore(true);
    setFavPage((p) => p + 1);
  }, []);

  const loadMoreTrash = useCallback(() => {
    setTrashLoadingMore(true);
    setTrashPage((p) => p + 1);
  }, []);

  // ── MenuBar ──────────────────────────────────────────────────────────────
  const handleRefresh = useCallback(() => {
    setTimelinePage(1);
    setFavPage(1);
    setTrashPage(1);
    setTimelineLoadingMore(false);
    setFavLoadingMore(false);
    setTrashLoadingMore(false);
    accTimelineRef.current = [];
    accFavRef.current = [];
    accTrashRef.current = [];
    void photosRefetchRef.current();
    void favRefetchRef.current();
    void trashedRefetchRef.current();
  }, []);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);

  const menuBarConfig: MenuBarConfig | null = useMemo(() => {
    if (!id) return null;

    const sizeItems = PHOTO_SIZE_LEVELS.map((level, i) => ({
      key: `size-${i}`,
      label: `${level.label}${i === sizeIndex ? " ✓" : ""}`,
      icon: <LayoutGrid size={14} />,
      onClick: () => {
        setSizeIndex(i);
        saveSizeIndex(i);
      },
    }));

    return {
      menus: [
        {
          key: "view",
          label: "显示",
          items: sizeItems,
        },
        {
          key: "actions",
          label: "操作",
          items: [
            {
              key: "select",
              label: isSelecting ? "取消选择" : "选择",
              icon: <MousePointerClick size={14} />,
              onClick: toggleSelectMode,
            },
            { type: "divider" as const },
            {
              key: "refresh",
              label: "刷新",
              icon: <RefreshCw size={14} />,
              disabled: false,
              onClick: handleRefresh,
            },
            {
              key: "sync",
              label: "同步资料库",
              icon: <FolderSync size={14} />,
              disabled: false,
              onClick: () => {
                setSyncClearData(false);
                setSyncModalOpen(true);
              },
            },
          ],
        },
      ],
      search: {
        appId: id,
        searchType: "photo" as const,
        placeholder: "搜索照片…",
        onSelect: () => {},
        recentItems: [],
      },
    };
  }, [id, handleRefresh, toggleSelectMode, isSelecting, sizeIndex]);

  useMenuBar(menuBarConfig);

  if (!id) return null;

  return (
    <div ref={rootRef} className="relative space-y-3">
      <Modal
        open={syncModalOpen}
        title="同步资料库"
        okText="开始同步"
        cancelText="取消"
        confirmLoading={isSyncing}
        onCancel={() => setSyncModalOpen(false)}
        onOk={async () => {
          if (!id) return;
          try {
            await syncMutation.mutateAsync({
              id,
              clearData: syncClearData,
            });
          } finally {
            setSyncModalOpen(false);
          }
        }}
      >
        <Checkbox
          checked={syncClearData}
          onChange={(e) => setSyncClearData(e.target.checked)}
        >
          清空数据重新同步
        </Checkbox>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          勾选后将删除所有照片数据并重新完整同步，适合修复数据异常或新增字段后重建。
        </p>
      </Modal>
      {/* Tab bar — iOS 26 style pill, centered */}
      <div className="relative flex items-center justify-center">
        <div className="inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-black/20 p-1 backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.06]">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium transition-all duration-200 ${
                  active
                    ? "bg-white/90 text-neutral-900 shadow-sm dark:bg-white/15 dark:text-white"
                    : "text-neutral-600 hover:bg-black/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200"
                }`}
                onClick={() => setTab(t.key)}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        {/* Photo count — right-aligned, clear of timeline scrubber */}
        <div className="absolute right-16 text-right">
          {tab === "timeline" && timelineTotal > 0 && (
            <Tag>{timelineTotal} 张</Tag>
          )}
          {tab === "favorites" && favTotal > 0 && <Tag>{favTotal} 张</Tag>}
          {tab === "trash" && trashTotal > 0 && <Tag>{trashTotal} 张</Tag>}
        </div>
      </div>

      {/* OCR search results banner */}
      {tab === "timeline" &&
        debouncedSearch.length >= 2 &&
        !ocrDismissed &&
        ocrResults.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950/50">
            <ScanText className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            {ocrFilterActive ? (
              <span className="text-sm text-blue-700 dark:text-blue-300">
                正在显示 {ocrResults.length} 张 OCR 匹配照片（包含「
                {debouncedSearch}」的文字）
              </span>
            ) : (
              <button
                type="button"
                className="cursor-pointer text-sm text-blue-700 hover:underline dark:text-blue-300"
                onClick={() => setOcrFilterActive(true)}
              >
                还找到 {ocrResults.length} 张包含「{debouncedSearch}
                」文字的照片，点击查看
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {ocrFilterActive && (
                <button
                  type="button"
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
                  onClick={() => setOcrFilterActive(false)}
                >
                  显示全部
                </button>
              )}
              <button
                type="button"
                className="cursor-pointer rounded p-0.5 text-blue-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900 dark:hover:text-blue-300"
                onClick={() => {
                  setOcrDismissed(true);
                  setOcrFilterActive(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

      {/* Content */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spin />
        </div>
      ) : isClipActive ? (
        !clipQuery.data ? (
          <div className="flex h-64 items-center justify-center">
            <Spin />
          </div>
        ) : clipResults.length > 0 ? (
          <div>
            <div className="mb-3 flex items-center gap-2 px-1">
              <Sparkles className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                找到 {clipResults.length} 张相似照片
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {clipResults.map((result) => (
                <div
                  key={result.photoId}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
                >
                  <img
                    src={`/api/photos/${result.photoId}/thumbnail`}
                    alt={result.filename}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                  {/* Similarity badge */}
                  <div className="absolute top-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                    {Math.round(result.similarity * 100)}%
                  </div>
                  {/* Filename on hover */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="truncate text-xs text-white">
                      {result.filename}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty description="未找到匹配的照片，试试换个描述" />
        )
      ) : tab === "timeline" ? (
        allTimelinePhotos.length > 0 ? (
          <PhotoTimeline
            photos={allTimelinePhotos}
            appId={id!}
            total={timelineTotal}
            hasMore={timelineHasMore}
            onLoadMore={loadMoreTimeline}
            isLoadingMore={timelineLoadingMore}
            onToggleFavorite={handleToggleFavorite}
            isSelecting={isSelecting}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSeekToDate={seekToDate}
            targetRowHeight={targetRowHeight}
          />
        ) : ocrFilterActive ? (
          <Empty description="当前加载的照片中没有 OCR 匹配结果" />
        ) : (
          <Empty description="暂无照片，请先同步应用" />
        )
      ) : tab === "folders" ? (
        <PhotoFoldersView
          appId={id}
          onToggleFavorite={handleToggleFavorite}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onNavigateToPerson={handleNavigateToPerson}
        />
      ) : tab === "favorites" ? (
        allFavPhotos.length > 0 ? (
          <PhotoTimeline
            photos={allFavPhotos}
            appId={id!}
            total={favTotal}
            hasMore={favHasMore}
            onLoadMore={loadMoreFav}
            isLoadingMore={favLoadingMore}
            onToggleFavorite={handleToggleFavorite}
            isSelecting={isSelecting}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            targetRowHeight={targetRowHeight}
          />
        ) : (
          <Empty description="暂无收藏照片，点击照片上的 ♥ 收藏" />
        )
      ) : tab === "locations" ? (
        <PhotoLocationTab
          appId={id}
          onToggleFavorite={handleToggleFavorite}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          targetRowHeight={targetRowHeight}
        />
      ) : tab === "people" ? (
        <PhotoPeopleView
          appId={id}
          onToggleFavorite={handleToggleFavorite}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          targetRowHeight={targetRowHeight}
          navigateToPersonId={navigateToPersonId}
          onNavigateToPersonHandled={handleNavigateToPersonHandled}
        />
      ) : tab === "trash" ? (
        allTrashPhotos.length > 0 ? (
          <div>
            <div className="mb-4 flex items-center justify-between px-4">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                {trashTotal} 张照片在回收站中
              </span>
              {selectedIds.size > 0 && (
                <div className="flex gap-2">
                  <Button onClick={handleRestore} loading={isRestoring}>
                    恢复选中
                  </Button>
                  <Button
                    onClick={handlePermanentDelete}
                    loading={isDeleting}
                    className="text-red-500"
                  >
                    永久删除
                  </Button>
                </div>
              )}
            </div>
            <PhotoTimeline
              photos={allTrashPhotos}
              appId={id!}
              total={trashTotal}
              hasMore={trashHasMore}
              onLoadMore={loadMoreTrash}
              isLoadingMore={trashLoadingMore}
              onToggleFavorite={handleToggleFavorite}
              isSelecting={isSelecting}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              targetRowHeight={targetRowHeight}
            />
          </div>
        ) : (
          <Empty description="回收站为空" />
        )
      ) : (
        <PhotoAlbumsView
          appId={id}
          albums={albums}
          isLoading={!albumsQuery.data}
          onToggleFavorite={handleToggleFavorite}
          onRefresh={() => void albumsQuery.refetch()}
          onNavigateToPerson={handleNavigateToPerson}
        />
      )}

      {/* Selection bar (floating bottom) */}
      <PhotoSelectionBar
        count={selectedIds.size}
        onAddToAlbum={() => setShowAlbumPicker(true)}
        onBatchFavorite={handleBatchFavorite}
        onBatchUnfavorite={handleBatchUnfavorite}
        onBatchHide={handleBatchHide}
        onTrash={handleTrash}
        onClear={clearSelection}
      />

      {/* Album picker dialog */}
      {showAlbumPicker && (
        <AlbumPickerDialog
          appId={id}
          selectedCount={selectedIds.size}
          onPick={handleAddToAlbum}
          onClose={() => setShowAlbumPicker(false)}
          isPending={isAddingToAlbum}
        />
      )}

      {/* Sync progress floating overlay */}
      <SyncProgressOverlay
        appId={id}
        onJobCompleted={() => void photosQuery.refetch()}
      />
    </div>
  );
}
