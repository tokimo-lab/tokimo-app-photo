import type { ShellJobEvent } from "@tokimo/sdk";
import { useJobEvents } from "@tokimo/sdk";
import { useMemo, useState } from "react";
import type { PhotoLibraryOutput } from "../../lib/types";

interface SyncProgressOptions {
  libraries?: PhotoLibraryOutput[];
  scanJobTypes: readonly string[];
  onContentRefresh: () => void;
  onLibraryRefresh: () => void;
  progressQueryKey?: (id: string) => unknown;
  fetchProgress?: (id: string) => Promise<unknown>;
}

function jobLibraryId(event: ShellJobEvent): string | null {
  const job = event.job;
  if (!job) return null;
  const metadata = job.metadata;
  const value =
    (typeof metadata === "object" && metadata !== null
      ? (metadata as Record<string, unknown>).libraryId ??
        (metadata as Record<string, unknown>).appId
      : undefined) ??
    job.appId ??
    event.appId;
  return typeof value === "string" ? value : null;
}

export function useSyncProgress({
  libraries,
  scanJobTypes,
  onContentRefresh,
  onLibraryRefresh,
}: SyncProgressOptions) {
  const [progress, setProgress] = useState<
    Record<string, { isActive: boolean; pct: number }>
  >({});
  useJobEvents({
    jobTypes: [...scanJobTypes],
    enabled: true,
    onEvent: (event: ShellJobEvent) => {
      const libraryId = jobLibraryId(event);
      if (!libraryId || !event.job) return;
      const job = event.job;
      const pct =
        typeof job.progress === "number" ? Math.round(job.progress) : 0;
      const terminal = new Set([
        "completed",
        "partially_completed",
        "failed",
        "cancelled",
      ]);
      const status = typeof job.status === "string" ? job.status : "";
      setProgress((prev) => ({
        ...prev,
        [libraryId]: { isActive: !terminal.has(status), pct },
      }));
      if (terminal.has(status)) {
        onContentRefresh();
        onLibraryRefresh();
      }
    },
  });
  return useMemo(() => {
    const seeded: Record<string, { isActive: boolean; pct: number }> = {};
    for (const lib of libraries ?? []) {
      seeded[lib.id] = progress[lib.id] ?? {
        isActive: lib.syncStatus === "syncing" || lib.syncStatus === "pending",
        pct: 0,
      };
    }
    return seeded;
  }, [libraries, progress]);
}
