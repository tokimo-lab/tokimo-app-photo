import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../generated/rust-api";
import type { PhotoLibraryOutput } from "../generated/rust-types";
import {
  type AppEntityEvent as AppEntityEventData,
  type ShellJobEvent,
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

function getJobRecord(event: ShellJobEvent): Record<string, unknown> | null {
  if (isRecord(event.job)) return event.job;
  if (!isRecord(event.data)) return null;
  const nestedJob = event.data.job;
  return isRecord(nestedJob) ? nestedJob : event.data;
}

function extractPhotoLibraryId(event: ShellJobEvent) {
  const job = getJobRecord(event);
  if (!job) return null;
  const params = isRecord(job.params) ? job.params : null;
  const data = isRecord(job.data) ? job.data : null;
  return (
    stringField(params, "photoLibraryId") ??
    stringField(params, "appId") ??
    stringField(data, "photoLibraryId") ??
    stringField(data, "appId") ??
    stringField(job, "photoLibraryId")
  );
}

function getJobStatus(event: ShellJobEvent) {
  const job = getJobRecord(event);
  return stringField(job, "status");
}

function getJobProgress(event: ShellJobEvent) {
  const job = getJobRecord(event);
  const data = isRecord(job?.data) ? job.data : null;
  const rich = isRecord(data?.progress) ? data.progress : null;
  const current = numberField(rich, "current");
  const total = numberField(rich, "total");
  const progress = numberField(job, "progress") ?? 0;
  const pct =
    current !== null && total !== null && total > 0
      ? Math.round((current / total) * 100)
      : progress;
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

  const scheduleEntityRefresh = useCallback(() => {
    if (entityRefreshTimerRef.current) return;
    entityRefreshTimerRef.current = setTimeout(() => {
      entityRefreshTimerRef.current = null;
      refreshContent();
    }, 800);
  }, [refreshContent]);

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
      const libraryId = extractPhotoLibraryId(event);
      if (!libraryId || !librariesRef.current.has(libraryId)) return;

      const job = getJobRecord(event);
      const jobId = stringField(job, "id");
      const status = getJobStatus(event);

      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        if (!jobId) {
          refreshContent();
        } else {
          const pendingJobs = pendingByLibRef.current.get(libraryId);
          if (pendingJobs) {
            const wasNonEmpty = pendingJobs.size > 0;
            pendingJobs.delete(jobId);
            if (wasNonEmpty && pendingJobs.size === 0) {
              refreshContent();
              pendingByLibRef.current.delete(libraryId);
            }
          } else {
            refreshContent();
          }
        }
        setProgressMap((prev) => {
          const next = { ...prev };
          if (status === "completed") {
            next[libraryId] = 100;
          } else {
            delete next[libraryId];
          }
          return next;
        });
        setActiveIds((prev) => {
          const next = new Set(prev);
          next.delete(libraryId);
          return next.size === prev.size ? prev : next;
        });
        return;
      }

      if (status === "pending" || status === "running" || status === "waiting") {
        if (jobId) {
          let pendingJobs = pendingByLibRef.current.get(libraryId);
          if (!pendingJobs) {
            pendingJobs = new Set();
            pendingByLibRef.current.set(libraryId, pendingJobs);
          }
          pendingJobs.add(jobId);
        }
      }

      setProgressMap((prev) => ({
        ...prev,
        [libraryId]: getJobProgress(event),
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
    };
  }, []);

  const result: Record<string, PhotoLibraryProgressState> = {};
  for (const id of activeIds) {
    result[id] = { isActive: true, pct: progressMap[id] ?? 0 };
  }
  return result;
}
