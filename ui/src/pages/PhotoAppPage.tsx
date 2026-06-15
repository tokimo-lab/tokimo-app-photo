import { Button, Empty, PillTabBar, Spin, Tag } from "@tokimo/ui";
import {
  Calendar,
  FolderOpen,
  Grid3x3,
  MapPin,
  Search,
  Star,
  Tag as TagIcon,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlbumPickerDialog } from "../components/AlbumPickerDialog";
import { PhotoAlbumsView } from "../components/PhotoAlbumsView";
import { PhotoFoldersView } from "../components/PhotoFoldersView";
import { PhotoLocationTab } from "../components/PhotoLocationTab";
import type { MapClusterSelection } from "../components/PhotoMapView";
import { usePhotoMenuBarState } from "../components/PhotoMenuBar";
import { PhotoPeopleView } from "../components/PhotoPeopleView";
import { PhotoSelectionBar } from "../components/PhotoSelectionBar";
import { PHOTO_SIZE_LEVELS } from "../components/PhotoSizeSlider";
import { PhotoTimeline } from "../components/PhotoTimeline";
import type { PhotoOutput } from "../generated/rust-api";
import { useToast, useWindowNav } from "@tokimo/sdk";
import { ClipSearchGrid, OcrSearchBanner } from "./PhotoSearchDisplay";
import { type TabKey, usePhotoData } from "./use-photo-data";
import { usePhotoMutations } from "./use-photo-mutations";

interface TagFilter {
  subcategory: string;
  icon?: string;
}

const tabs: { key: TabKey; label: string; icon: typeof Calendar }[] = [
  { key: "timeline", label: "时间线", icon: Calendar },
  { key: "folders", label: "文件夹", icon: FolderOpen },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "locations", label: "地点", icon: MapPin },
  { key: "people", label: "人物", icon: Users },
  { key: "albums", label: "相册", icon: Grid3x3 },
  { key: "trash", label: "回收站", icon: Trash2 },
];

export default function PhotoAppPage({
  photoLibraryId,
  syncing,
}: {
  photoLibraryId?: string;
  syncing?: boolean;
}) {
  const nav = useWindowNav();
  const metadata = (nav as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
  const id = photoLibraryId ?? (metadata.appId as string | undefined);
  const initialDate = metadata.initialDate as string | undefined;
  const message = useToast();
  const rootRef = useRef<HTMLDivElement>(null);
  const [windowContent, setWindowContent] = useState<HTMLElement | null>(null);

  // ── Grid size state (from menubar context) ───────────────────────────
  const menuBarState = usePhotoMenuBarState();
  const { sizeIndex, isSelecting, setIsSelecting } = menuBarState;
  const targetRowHeight = PHOTO_SIZE_LEVELS[sizeIndex].height;
  const [tab, setTabRaw] = useState<TabKey>(
    (metadata.tab as TabKey) || "timeline",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const setTab = useCallback(
    (t: TabKey) => {
      setTabRaw(t);
      setSelectedIds(new Set());
      menuBarState.setIsSelecting(false);
      setSearchQuery("");
    },
    [menuBarState.setIsSelecting],
  );

  // ── Navigate to person (from lightbox face click) ──────────────────
  const [navigateToPersonId, setNavigateToPersonId] = useState<string | null>(
    null,
  );
  const [similarSourceId, setSimilarSourceId] = useState<string | null>(
    (metadata.similarSourceId as string) || null,
  );
  const [tagFilter, setTagFilter] = useState<TagFilter | null>(
    (metadata.tagFilter as TagFilter) ?? null,
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
  // Locate the window content area for portalling overlays into it
  useEffect(() => {
    if (rootRef.current) {
      setWindowContent(
        rootRef.current.closest("[data-window-content]") as HTMLElement | null,
      );
    }
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

  // ── Selection state ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = useCallback(
    (photo: PhotoOutput) => {
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
    },
    [setIsSelecting],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }, [setIsSelecting]);

  // ── Data hook (queries, accumulation, pagination) ──────────────────────
  const {
    debouncedSearch,
    ocrFilterActive,
    setOcrFilterActive,
    ocrDismissed,
    setOcrDismissed,
    photosQuery,
    favoritesQuery,
    trashedQuery,
    albumsQuery,
    similarPhotos,
    similarQuery,
    tagPhotos,
    tagClipQuery,
    allTimelinePhotos,
    timelineTotal,
    timelineHasMore,
    loadMoreTimeline,
    timelineLoadingMore,
    upwardHasMore,
    loadMoreUpward,
    upwardLoadingMore,
    allFavPhotos,
    favTotal,
    favHasMore,
    loadMoreFav,
    favLoadingMore,
    allTrashPhotos,
    trashTotal,
    trashHasMore,
    loadMoreTrash,
    trashLoadingMore,
    albums,
    ocrResults,
    clipResults,
    clipQuery,
    isLoading,
    isClipActive,
    seekToDate,
    resetTrash,
  } = usePhotoData({
    id,
    tab,
    similarSourceId,
    tagFilter,
    searchQuery,
    initialDate,
  });

  // Disable pagination during sync — offset-based pages become unreliable
  // while the dataset is being mutated by the backend.
  const guardedLoadMoreTimeline = syncing ? undefined : loadMoreTimeline;
  const guardedLoadMoreUpward = syncing ? undefined : loadMoreUpward;
  const guardedLoadMoreFav = syncing ? undefined : loadMoreFav;
  const guardedLoadMoreTrash = syncing ? undefined : loadMoreTrash;

  // ── Mutations hook ─────────────────────────────────────────────────────
  const {
    handleToggleFavorite,
    handleBatchFavorite,
    handleBatchUnfavorite,
    handleAddToAlbum,
    handleBatchHide,
    handleTrash,
    handleRestore,
    handlePermanentDelete,
    isRestoring,
    isDeleting,
    isAddingToAlbum,
    showAlbumPicker,
    setShowAlbumPicker,
  } = usePhotoMutations({
    id,
    selectedIds,
    clearSelection,
    message,
    refetchPhotos: () => void photosQuery.refetch(),
    refetchFavorites: () => void favoritesQuery.refetch(),
    refetchTrashed: () => void trashedQuery.refetch(),
    refetchAlbums: () => void albumsQuery.refetch(),
    resetTrash,
  });

  if (!id) return null;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-3 lg:gap-4">
      <PillTabBar
        tabs={tabs}
        activeTab={tab}
        onTabChange={setTab}
        trailingClassName="right-16"
        trailing={
          <>
            {tab === "timeline" && similarSourceId
              ? similarPhotos.length > 0 && (
                  <Tag>{similarPhotos.length} 张相似</Tag>
                )
              : tab === "timeline" &&
                timelineTotal > 0 && <Tag>{timelineTotal} 张</Tag>}
            {tab === "favorites" && favTotal > 0 && <Tag>{favTotal} 张</Tag>}
            {tab === "trash" && trashTotal > 0 && <Tag>{trashTotal} 张</Tag>}
          </>
        }
      />

      {/* Scrollable content */}
      <div className="space-y-3">
        {/* OCR search results banner */}
        {tab === "timeline" &&
          debouncedSearch.length >= 2 &&
          !ocrDismissed &&
          ocrResults.length > 0 && (
            <OcrSearchBanner
              debouncedSearch={debouncedSearch}
              ocrResults={ocrResults}
              ocrFilterActive={ocrFilterActive}
              setOcrFilterActive={setOcrFilterActive}
              setOcrDismissed={setOcrDismissed}
            />
          )}

        {/* Content */}
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spin />
          </div>
        ) : isClipActive ? (
          <ClipSearchGrid
            isQueryLoaded={!!clipQuery.data}
            results={clipResults}
          />
        ) : tab === "timeline" && similarSourceId ? (
          /* ── Similar photos filtered view ─────────────────────────── */
          <>
            <div className="flex items-center gap-1 pl-1 pr-14 text-sm">
              <button
                type="button"
                onClick={() => setSimilarSourceId(null)}
                className="cursor-pointer text-blue-500 transition-colors hover:text-blue-600 hover:underline dark:text-blue-400"
              >
                时间线
              </button>
              <span className="text-fg-muted">/</span>
              <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
                <Search className="h-3.5 w-3.5" />
                {similarPhotos.length > 0
                  ? `${similarPhotos.length} 张相似照片`
                  : "正在搜索相似照片…"}
              </span>
            </div>
            {similarQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Spin />
              </div>
            ) : similarPhotos.length > 0 ? (
              <PhotoTimeline
                photos={similarPhotos}
                appId={id!}
                total={similarPhotos.length}
                hasMore={false}
                onLoadMore={() => {}}
                isLoadingMore={false}
                onToggleFavorite={handleToggleFavorite}
                isSelecting={isSelecting}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                targetRowHeight={targetRowHeight}
              />
            ) : (
              <Empty description="未找到相似照片" />
            )}
          </>
        ) : tab === "timeline" && tagFilter ? (
          /* ── Tag filtered view ──────────────────────────────────────── */
          <>
            <div className="flex items-center gap-1 pl-1 pr-14 text-sm">
              <button
                type="button"
                onClick={() => setTagFilter(null)}
                className="cursor-pointer text-blue-500 transition-colors hover:text-blue-600 hover:underline dark:text-blue-400"
              >
                时间线
              </button>
              <span className="text-fg-muted">/</span>
              <span className="flex items-center gap-1.5 font-medium text-fg-secondary">
                <TagIcon className="h-3.5 w-3.5" />
                {tagFilter.icon} {tagFilter.subcategory}
                {tagPhotos.length > 0 && ` · ${tagPhotos.length} 张照片`}
              </span>
            </div>
            {tagClipQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Spin />
              </div>
            ) : tagPhotos.length > 0 ? (
              <PhotoTimeline
                photos={tagPhotos}
                appId={id!}
                total={tagPhotos.length}
                hasMore={false}
                onLoadMore={() => {}}
                isLoadingMore={false}
                onToggleFavorite={handleToggleFavorite}
                isSelecting={isSelecting}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                targetRowHeight={targetRowHeight}
              />
            ) : (
              <Empty description="未找到匹配该标签的照片" />
            )}
          </>
        ) : tab === "timeline" ? (
          allTimelinePhotos.length > 0 ? (
            <PhotoTimeline
              photos={allTimelinePhotos}
              appId={id!}
              total={timelineTotal}
              hasMore={timelineHasMore}
              onLoadMore={guardedLoadMoreTimeline}
              isLoadingMore={timelineLoadingMore}
              hasNewer={upwardHasMore}
              onLoadNewer={guardedLoadMoreUpward}
              isLoadingNewer={upwardLoadingMore}
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
              onLoadMore={guardedLoadMoreFav}
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
            initialBbox={
              metadata.locationBbox as MapClusterSelection | undefined
            }
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
                <span className="text-sm text-fg-muted">
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
                onLoadMore={guardedLoadMoreTrash}
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
      </div>

      {/* Selection bar (floating bottom) */}
      <PhotoSelectionBar
        container={windowContent}
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
    </div>
  );
}
