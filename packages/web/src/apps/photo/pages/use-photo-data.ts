import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PAGE_SIZE } from "@/apps/photo/components/photo-utils";
import {
  clearViewerPhotos,
  setViewerPhotos,
} from "@/apps/photo/components/photo-viewer-store";
import type { PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";

export type TabKey =
  | "timeline"
  | "folders"
  | "favorites"
  | "locations"
  | "people"
  | "albums"
  | "trash";

interface UsePhotoDataParams {
  id: string | undefined;
  tab: TabKey;
  similarSourceId: string | null;
  tagFilter: { subcategory: string; icon?: string } | null;
  searchQuery: string;
  initialDate?: string;
}

export function usePhotoData({
  id,
  tab,
  similarSourceId,
  tagFilter,
  searchQuery,
  initialDate,
}: UsePhotoDataParams) {
  // ── Debounced search ─────────────────────────────────────────────────
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchMode] = useState<"filename" | "clip">("filename");

  // ── OCR filter state ─────────────────────────────────────────────────
  const [ocrFilterActive, setOcrFilterActive] = useState(false);
  const [ocrDismissed, setOcrDismissed] = useState(false);

  // ── Pagination state ─────────────────────────────────────────────────
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineBeforeDate, setTimelineBeforeDate] = useState<
    string | undefined
  >(initialDate);
  const [favPage, setFavPage] = useState(1);
  const [trashPage, setTrashPage] = useState(1);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);
  const [favLoadingMore, setFavLoadingMore] = useState(false);
  const [trashLoadingMore, setTrashLoadingMore] = useState(false);
  const accTimelineRef = useRef<PhotoOutput[]>([]);
  const accUpwardRef = useRef<PhotoOutput[]>([]);
  const [upwardPage, setUpwardPage] = useState(1);
  const [upwardLoadingMore, setUpwardLoadingMore] = useState(false);
  const [upwardEnabled, setUpwardEnabled] = useState(false);
  const accFavRef = useRef<PhotoOutput[]>([]);
  const accTrashRef = useRef<PhotoOutput[]>([]);

  // Debounce search query + reset pagination
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setTimelinePage(1);
      accTimelineRef.current = [];
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [searchQuery]);

  // Reset OCR filter state when search changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger on search change
  useEffect(() => {
    setOcrFilterActive(false);
    setOcrDismissed(false);
  }, [debouncedSearch]);

  // ── Similar photos query ─────────────────────────────────────────────
  const similarQuery = api.photo.similarPhotos.useQuery(
    { photoId: similarSourceId!, limit: 50 },
    { enabled: !!similarSourceId && tab === "timeline" },
  );

  const similarPhotos: PhotoOutput[] = useMemo(() => {
    if (!similarQuery.data?.items) return [];
    return similarQuery.data.items.map((item) => ({
      id: item.photoId,
      appId: item.appId,
      filename: item.filename,
      path: item.path,
      title: item.title ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      fileSize: item.fileSize ?? null,
      mimeType: item.mimeType ?? null,
      takenAt: item.takenAt ?? null,
      thumbnailPath: item.thumbnailPath ?? null,
      isFavorite: item.isFavorite,
      cameraMake: null,
      cameraModel: null,
      orientation: null,
      liveVideoPath: null,
      sourceId: item.appId,
    }));
  }, [similarQuery.data]);

  // ── Tag query ────────────────────────────────────────────────────────
  const tagClipQuery = api.photo.clipSearch.useQuery(
    { id: id!, q: tagFilter?.subcategory ?? "" },
    { enabled: !!id && !!tagFilter && tab === "timeline" },
  );

  const tagPhotos: PhotoOutput[] = useMemo(() => {
    if (!tagClipQuery.data) return [];
    return tagClipQuery.data.map((item) => ({
      id: item.photoId,
      appId: item.appId,
      filename: item.filename,
      path: item.path,
      title: item.title ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      fileSize: item.fileSize ?? null,
      mimeType: item.mimeType ?? null,
      takenAt: item.takenAt ?? null,
      thumbnailPath: item.thumbnailPath ?? null,
      isFavorite: item.isFavorite,
      cameraMake: null,
      cameraModel: null,
      orientation: null,
      liveVideoPath: null,
      sourceId: item.appId,
    }));
  }, [tagClipQuery.data]);

  // ── Main queries ─────────────────────────────────────────────────────
  const photosQuery = api.photo.listPhotos.useQuery(
    {
      id: id!,
      page: timelinePage,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      search: debouncedSearch || undefined,
      beforeDate: timelineBeforeDate,
    },
    {
      enabled: !!id && tab === "timeline",
      // Keep previous data visible during seek-triggered refetches.
      // Without this, photosQuery.data becomes undefined → isLoading=true
      // → PhotoTimeline unmounts → pendingSeek state is lost and the
      // post-seek re-alignment (sticky-tab compensation) never runs.
      placeholderData: (prev) => prev,
    },
  );

  const upwardAfterDate = useMemo(() => {
    const anchor = timelineBeforeDate ?? initialDate;
    if (!anchor) return undefined;
    const d = new Date(anchor);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [timelineBeforeDate, initialDate]);

  const upwardQuery = api.photo.listPhotos.useQuery(
    {
      id: id!,
      page: upwardPage,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "asc",
      search: debouncedSearch || undefined,
      afterDate: upwardAfterDate,
    },
    {
      enabled: !!id && !!upwardAfterDate && upwardEnabled && tab === "timeline",
    },
  );

  const favoritesQuery = api.photo.listPhotos.useQuery(
    {
      id: id!,
      page: favPage,
      pageSize: PAGE_SIZE,
      sortBy: "takenAt",
      sortDir: "desc",
      favoritesOnly: true,
    },
    { enabled: !!id && tab === "favorites" },
  );

  const albumsQuery = api.photo.listPhotoAlbums.useQuery(
    { id: id! },
    { enabled: !!id && tab === "albums" },
  );

  const trashedQuery = api.photo.listTrashedPhotos.useQuery(
    { id: id!, page: trashPage, pageSize: PAGE_SIZE },
    { enabled: !!id && tab === "trash" },
  );

  // ── OCR / CLIP search ───────────────────────────────────────────────
  const ocrQuery = api.photo.ocrSearch.useQuery(
    { id: id!, q: debouncedSearch! },
    {
      enabled:
        !!id &&
        !!debouncedSearch &&
        debouncedSearch.length >= 2 &&
        tab === "timeline",
    },
  );
  const ocrResults = ocrQuery.data ?? [];

  const clipQuery = api.photo.clipSearch.useQuery(
    { id: id!, q: debouncedSearch },
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

  const ocrPhotoIds = useMemo(
    () => new Set(ocrResults.map((r) => r.photoId)),
    [ocrResults],
  );

  // ── Accumulate timeline photos (downward = older) ────────────────────
  const timelineTotal = photosQuery.data?.total ?? 0;
  useEffect(() => {
    if (!photosQuery.data?.items) return;
    // Critical: when query key changes (e.g. seek), `placeholderData` keeps
    // `data` populated with the PREVIOUS key's response. We must NOT
    // re-populate the accumulator from that stale data — otherwise the
    // freshly-cleared `accTimelineRef` is immediately re-filled with the
    // wrong-window photos (e.g. today's photos after seeking to 3-15).
    if (photosQuery.isPlaceholderData) return;
    setTimelineLoadingMore(false);
    if (timelinePage === 1) {
      accTimelineRef.current = photosQuery.data.items;
    } else {
      const ids = new Set(accTimelineRef.current.map((p) => p.id));
      const newItems = photosQuery.data.items.filter((p) => !ids.has(p.id));
      accTimelineRef.current = [...accTimelineRef.current, ...newItems];
    }
  }, [photosQuery.data, photosQuery.isPlaceholderData, timelinePage]);

  // Accumulate upward photos (newer than initialDate)
  const upwardTotal = upwardQuery.data?.total ?? 0;
  useEffect(() => {
    if (!upwardQuery.data?.items) return;
    setUpwardLoadingMore(false);
    if (upwardPage === 1) {
      accUpwardRef.current = upwardQuery.data.items;
    } else {
      const ids = new Set(accUpwardRef.current.map((p) => p.id));
      const newItems = upwardQuery.data.items.filter((p) => !ids.has(p.id));
      accUpwardRef.current = [...accUpwardRef.current, ...newItems];
    }
  }, [upwardQuery.data, upwardPage]);

  // Merge upward (reversed to desc) + downward
  // biome-ignore lint/correctness/useExhaustiveDependencies: upwardQuery.data triggers re-merge of ref-accumulated photos
  const allTimelinePhotosRaw = useMemo(() => {
    const downward =
      accTimelineRef.current.length > 0
        ? accTimelineRef.current
        : (photosQuery.data?.items ?? []);
    if (accUpwardRef.current.length === 0) return downward;
    const upwardReversed = [...accUpwardRef.current].reverse();
    const downIds = new Set(downward.map((p) => p.id));
    const uniqueUp = upwardReversed.filter((p) => !downIds.has(p.id));
    return [...uniqueUp, ...downward];
  }, [photosQuery.data?.items, upwardQuery.data?.items]);

  const upwardHasMore =
    !!upwardAfterDate &&
    (!upwardEnabled || accUpwardRef.current.length < upwardTotal);

  const allTimelinePhotos = useMemo(
    () =>
      ocrFilterActive
        ? allTimelinePhotosRaw.filter((p) => ocrPhotoIds.has(p.id))
        : allTimelinePhotosRaw,
    [ocrFilterActive, allTimelinePhotosRaw, ocrPhotoIds],
  );
  const timelineHasMore =
    !ocrFilterActive && allTimelinePhotos.length < timelineTotal;

  // Sync photo list to viewer store
  useEffect(() => {
    if (id) setViewerPhotos(id, allTimelinePhotos);
    return () => {
      if (id) clearViewerPhotos(id);
    };
  }, [id, allTimelinePhotos]);

  // Accumulate favorites
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

  // Accumulate trash
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

  const isClipActive =
    searchMode === "clip" && debouncedSearch.length >= 2 && tab === "timeline";

  // ── Load more / seek callbacks ───────────────────────────────────────
  const loadMoreTimeline = useCallback(() => {
    setTimelineLoadingMore(true);
    setTimelinePage((p) => p + 1);
  }, []);

  const loadMoreUpward = useCallback(() => {
    if (!upwardAfterDate) return;
    if (!upwardEnabled) {
      setUpwardEnabled(true);
      return;
    }
    setUpwardLoadingMore(true);
    setUpwardPage((p) => p + 1);
  }, [upwardAfterDate, upwardEnabled]);

  const seekToDate = useCallback((datePrefix: string) => {
    const parts = datePrefix.split("-");
    let beforeDate: string;
    if (parts.length >= 3) {
      beforeDate = datePrefix;
    } else if (parts.length === 2) {
      const y = Number.parseInt(parts[0], 10);
      const m = Number.parseInt(parts[1], 10);
      const lastDay = new Date(y, m, 0).getDate();
      beforeDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    } else {
      beforeDate = `${parts[0]}-12-31`;
    }
    accTimelineRef.current = [];
    accUpwardRef.current = [];
    setUpwardEnabled(false);
    setUpwardPage(1);
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

  const resetTrash = useCallback(() => {
    setTrashPage(1);
    accTrashRef.current = [];
  }, []);

  return {
    debouncedSearch,
    ocrFilterActive,
    setOcrFilterActive,
    ocrDismissed,
    setOcrDismissed,
    // queries (for refetch)
    photosQuery,
    favoritesQuery,
    trashedQuery,
    albumsQuery,
    // similar
    similarPhotos,
    similarQuery,
    // tag
    tagPhotos,
    tagClipQuery,
    // timeline
    allTimelinePhotos,
    timelineTotal,
    timelineHasMore,
    loadMoreTimeline,
    timelineLoadingMore,
    upwardHasMore,
    loadMoreUpward,
    upwardLoadingMore,
    // favorites
    allFavPhotos,
    favTotal,
    favHasMore,
    loadMoreFav,
    favLoadingMore,
    // trash
    allTrashPhotos,
    trashTotal,
    trashHasMore,
    loadMoreTrash,
    trashLoadingMore,
    // albums
    albums,
    // search
    ocrResults,
    ocrPhotoIds,
    clipResults,
    clipQuery,
    isLoading,
    isClipActive,
    // actions
    seekToDate,
    resetTrash,
  };
}
