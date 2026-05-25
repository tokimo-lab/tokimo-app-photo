import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import type { PhotoLibraryOutput } from "@/generated/rust-types";
import { useJobEvents } from "@/system/events/useJobEvents";

const PHOTO_SCAN_JOB_TYPES = [
  "file_scrape",
  "photo_ocr_scan",
  "photo_clip_scan",
  "photo_face_scan",
  "photo_geocode_scan",
] as const;

interface JobProgressData {
  status: string;
  completed: number;
  running: number;
  pending: number;
  failed: number;
}

export interface PhotoLibraryProgressState {
  isActive: boolean;
  pct: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function extractPhotoLibraryId(job: {
  appId: string | null;
  params: Record<string, unknown>;
  data?: Record<string, unknown> | null;
}) {
  const data = isRecord(job.data) ? job.data : null;
  return (
    job.appId ??
    stringField(job.params, "photoLibraryId") ??
    stringField(job.params, "appId") ??
    stringField(data, "photoLibraryId") ??
    stringField(data, "appId")
  );
}

function toProgressState(
  data: JobProgressData,
): PhotoLibraryProgressState | null {
  const total = data.completed + data.running + data.pending + data.failed;
  const isActive =
    data.status === "syncing" || data.running > 0 || data.pending > 0;
  if (!isActive) return null;
  return {
    isActive: true,
    pct: total > 0 ? Math.round((data.completed / total) * 100) : 0,
  };
}

export function useLibraryItemProgress(
  libraries: PhotoLibraryOutput[] | undefined,
): Record<string, PhotoLibraryProgressState> {
  const queryClient = useQueryClient();
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [progressMap, setProgressMap] = useState<
    Record<string, PhotoLibraryProgressState>
  >({});

  const librariesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    librariesRef.current = new Set(
      (libraries ?? []).map((library) => library.id),
    );
  }, [libraries]);

  useEffect(() => {
    if (!libraries) return;
    const syncing = libraries
      .filter((library) => library.syncStatus === "syncing")
      .map((library) => library.id);
    if (syncing.length === 0) return;
    setActiveIds((prev) => {
      const next = new Set(prev);
      for (const id of syncing) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [libraries]);

  const fetchAllRef = useRef<(() => Promise<void>) | null>(null);
  const wsFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttlePendingRef = useRef(false);

  const refreshContent = useCallback(() => {
    api.photo.listPhotos.invalidate(queryClient);
    api.photo.listPhotoAlbums.invalidate(queryClient);
    api.photo.list.invalidate(queryClient);
  }, [queryClient]);

  const throttledRefresh = useCallback(() => {
    if (throttleTimerRef.current) {
      throttlePendingRef.current = true;
      return;
    }
    refreshContent();
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      if (throttlePendingRef.current) {
        throttlePendingRef.current = false;
        refreshContent();
      }
    }, 500);
  }, [refreshContent]);

  const { connected } = useJobEvents({
    jobTypes: PHOTO_SCAN_JOB_TYPES,
    enabled: (libraries ?? []).length > 0,
    onEvent: (event) => {
      if (event.type !== "job_update") return;
      const libraryId = extractPhotoLibraryId(event.job);
      if (!libraryId || !librariesRef.current.has(libraryId)) return;

      setActiveIds((prev) => {
        if (prev.has(libraryId)) return prev;
        const next = new Set(prev);
        next.add(libraryId);
        return next;
      });

      queryClient.invalidateQueries({
        queryKey: api.photo.getSyncProgress.queryKey({ id: libraryId }),
      });

      if (wsFetchTimerRef.current) clearTimeout(wsFetchTimerRef.current);
      wsFetchTimerRef.current = setTimeout(() => {
        wsFetchTimerRef.current = null;
        void fetchAllRef.current?.();
      }, 1000);

      if (event.job.status === "completed" || event.job.status === "failed") {
        throttledRefresh();
      }
    },
  });

  const fetchAll = useCallback(async () => {
    const ids = Array.from(activeIds);
    if (ids.length === 0) {
      setProgressMap({});
      return;
    }

    const nextProgress: Record<string, PhotoLibraryProgressState> = {};
    const settledIds: string[] = [];

    await Promise.all(
      ids.map(async (id) => {
        try {
          const data = await queryClient.fetchQuery({
            queryKey: api.photo.getSyncProgress.queryKey({ id }),
            queryFn: () => api.photo.getSyncProgress.fetch({ id }),
            staleTime: 1000,
          });
          const state = toProgressState(data);
          if (state) {
            nextProgress[id] = state;
          } else {
            settledIds.push(id);
          }
        } catch (err) {
          console.warn("[photo] failed to fetch sync progress", err);
          nextProgress[id] = { isActive: true, pct: 0 };
        }
      }),
    );

    setProgressMap(nextProgress);
    if (settledIds.length > 0) {
      setActiveIds((prev) => {
        const next = new Set(prev);
        for (const id of settledIds) next.delete(id);
        return next.size === prev.size ? prev : next;
      });
    }
  }, [activeIds, queryClient]);

  fetchAllRef.current = fetchAll;

  useEffect(() => {
    if (activeIds.size === 0) {
      setProgressMap({});
      return;
    }
    void fetchAll();
    if (connected) return;
    const pollTimer = setInterval(() => {
      void fetchAll();
    }, 5000);
    return () => clearInterval(pollTimer);
  }, [activeIds, connected, fetchAll]);

  useEffect(() => {
    return () => {
      if (wsFetchTimerRef.current) clearTimeout(wsFetchTimerRef.current);
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
    };
  }, []);

  const result: Record<string, PhotoLibraryProgressState> = { ...progressMap };
  for (const id of activeIds) {
    result[id] ??= { isActive: true, pct: 0 };
  }
  return result;
}
