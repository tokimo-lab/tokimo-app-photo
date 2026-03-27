import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../generated/rust-api";
import { useJobEvents } from "../../system/events/useJobEvents";

interface SyncProgressOverlayProps {
  appId: string;
}

/**
 * Floating overlay (bottom-right) showing photo library sync progress.
 * Visible while syncing or processing jobs, auto-hides when done.
 */
export function SyncProgressOverlay({ appId }: SyncProgressOverlayProps) {
  const [dismissed, setDismissed] = useState(false);

  const progressQuery = api.app.getSyncProgress.useQuery(
    { id: appId },
    { refetchInterval: 3000 },
  );

  const data = progressQuery.data;

  // Listen for job_update SSE events to trigger refetch
  useJobEvents({
    onEvent: (event) => {
      if (event.type === "job_update") {
        const payload = event.job.payload as Record<string, unknown>;
        if (payload?.appId === appId) {
          void progressQuery.refetch();
        }
      }
    },
  });

  // Reset dismissed when a new sync starts
  useEffect(() => {
    if (data?.status === "syncing") {
      setDismissed(false);
    }
  }, [data?.status]);

  const handleDismiss = useCallback(() => setDismissed(true), []);

  if (!data || dismissed) return null;

  const { total, completed, running, pending, failed } = data;
  const active = total > 0 && (running > 0 || pending > 0);
  const isSyncing = data.status === "syncing";

  // Only show when there's active work
  if (!active && !isSyncing) return null;

  const processed = completed + failed;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex min-w-[260px] items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/80">
      <Loader2 size={16} className="shrink-0 animate-spin text-orange-400" />

      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-medium">
            {isSyncing && total === 0
              ? "正在扫描文件…"
              : `处理中 ${processed}/${total}`}
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            className="ml-2 rounded p-0.5 text-white/40 hover:text-white/80"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-orange-500 transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        {running > 0 && (
          <span className="text-[11px] text-white/40">
            {running} 个任务运行中
            {pending > 0 && `，${pending} 个排队中`}
          </span>
        )}
      </div>
    </div>
  );
}
