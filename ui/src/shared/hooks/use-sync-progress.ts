import { useMemo, useState } from "react";
import type { PhotoLibraryOutput, WsJobEvent } from "../../lib/types";
import { useJobEvents } from "../../shell/hooks";

interface SyncProgressOptions {
  libraries?: PhotoLibraryOutput[];
  scanJobTypes: readonly string[];
  onContentRefresh: () => void;
  onLibraryRefresh: () => void;
  progressQueryKey?: (id: string) => unknown;
  fetchProgress?: (id: string) => Promise<unknown>;
}

function jobLibraryId(event: WsJobEvent): string | null {
  const metadata = event.job.metadata;
  const value =
    metadata?.libraryId ?? metadata?.appId ?? event.job.appId ?? event.appId;
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
    onEvent: (event) => {
      const libraryId = jobLibraryId(event);
      if (!libraryId) return;
      const pct =
        typeof event.job.progress === "number"
          ? Math.round(event.job.progress)
          : 0;
      const terminal = new Set([
        "completed",
        "partially_completed",
        "failed",
        "cancelled",
      ]);
      setProgress((prev) => ({
        ...prev,
        [libraryId]: { isActive: !terminal.has(event.job.status), pct },
      }));
      if (terminal.has(event.job.status)) {
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
