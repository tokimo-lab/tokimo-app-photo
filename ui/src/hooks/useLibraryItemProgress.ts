import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../generated/rust-api";
import type { PhotoLibraryOutput } from "../generated/rust-types";
import {
  type AppEntityEvent as AppEntityEventData,
  useAppEntityEvents,
  useJobEvents,
} from "@tokimo/sdk";

const PHOTO_SCAN_JOB_TYPES = [
  "file_scrape",
  "photo_ocr_scan",
  "photo_clip_scan",
  "photo_face_scan",
  "photo_geocode_scan",
] as const;

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

function numberField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" ? value : null;
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

function getJobProgress(job: {
  progress: number;
  data?: Record<string, unknown> | null;
}) {
  const data = isRecord(job.data) ? job.data : null;
  const rich = isRecord(data?.progress) ? data.progress : null;
  const current = numberField(rich, "current");
  const total = numberField(rich, "total");
  const pct =
    current !== null && total !== null && total > 0
      ? Math.round((current / total) * 100)
      : job.progress;
  return Math.max(0, Math.min(100, pct));
}

export function useLibraryItemProgress(
  libraries: PhotoLibraryOutput[] | undefined,
): Record<string, PhotoLibraryProgressState> {
  const queryClient = useQueryClient();
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const librariesRef = useRef<Set<string>>(new Set());
  const pendingByLibRef = useRef(new Map<string, Set<string>>());
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const throttlePendingRef = useRef(false);
  const entityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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

  const scheduleEntityRefresh = useCallback(() => {
    if (entityRefreshTimerRef.current) return;
    entityRefreshTimerRef.current = setTimeout(() => {
      entityRefreshTimerRef.current = null;
      refreshContent();
    }, 800);
  }, [refreshContent]);

  const clearLibraryProgress = useCallback((libraryId: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      next.delete(libraryId);
      return next.size === prev.size ? prev : next;
    });
    setProgressMap((prev) => {
      if (!(libraryId in prev)) return prev;
      const next = { ...prev };
      delete next[libraryId];
      return next;
    });
  }, []);

  const handleEntityEvent = useCallback(
    (event: AppEntityEventData) => {
      const scope = event.scope ?? "";
      const libraryId = scope.startsWith("library:")
        ? scope.slice("library:".length)
        : null;
      if (!libraryId || !librariesRef.current.has(libraryId)) return;
      scheduleEntityRefresh();
    },
    [scheduleEntityRefresh],
  );

  useJobEvents({
    jobTypes: PHOTO_SCAN_JOB_TYPES,
    enabled: (libraries ?? []).length > 0,
    onEvent: (event) => {
      if (event.type !== "job_update") return;
      const libraryId = extractPhotoLibraryId(event.job);
      if (!libraryId || !librariesRef.current.has(libraryId)) return;

      const jobId = event.job.id;
      const status = event.job.status;

      if (status === "completed" || status === "failed") {
        throttledRefresh();
        if (jobId) {
          const pendingJobs = pendingByLibRef.current.get(libraryId);
          if (pendingJobs) {
            const wasNonEmpty = pendingJobs.size > 0;
            pendingJobs.delete(jobId);
            if (wasNonEmpty && pendingJobs.size > 0) return;
            pendingByLibRef.current.delete(libraryId);
          }
        }
        clearLibraryProgress(libraryId);
        return;
      }

      if (
        status === "pending" ||
        status === "running" ||
        status === "waiting"
      ) {
        let pendingJobs = pendingByLibRef.current.get(libraryId);
        if (!pendingJobs) {
          pendingJobs = new Set();
          pendingByLibRef.current.set(libraryId, pendingJobs);
        }
        pendingJobs.add(jobId);
      }

      setProgressMap((prev) => ({
        ...prev,
        [libraryId]: getJobProgress(event.job),
      }));
      setActiveIds((prev) => {
        if (prev.has(libraryId)) return prev;
        const next = new Set(prev);
        next.add(libraryId);
        return next;
      });
    },
  });

  useAppEntityEvents({
    appId: "photo",
    kind: "photo_item",
    onEvent: handleEntityEvent,
    enabled: (libraries ?? []).length > 0,
  });

  useEffect(() => {
    return () => {
      if (entityRefreshTimerRef.current) {
        clearTimeout(entityRefreshTimerRef.current);
        entityRefreshTimerRef.current = null;
      }
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, []);

  const result: Record<string, PhotoLibraryProgressState> = {};
  for (const id of activeIds) {
    result[id] = { isActive: true, pct: progressMap[id] ?? 0 };
  }
  return result;
}
