import { LoadingOutlined } from "@tokiomo/components";
import { CheckCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../generated/rust-api";
import { useJobEvents } from "../../system/events/useJobEvents";

interface SyncProgressOverlayProps {
  appId: string;
  /** Called when a file_scrape job completes, so the gallery can refresh */
  onJobCompleted?: () => void;
}

/**
 * Floating overlay (bottom-right of parent) showing photo library sync progress.
 * Visible while syncing or processing jobs, auto-hides after completion.
 */
export function SyncProgressOverlay({
  appId,
  onJobCompleted,
}: SyncProgressOverlayProps) {
  const [dismissed, setDismissed] = useState(false);
  const [completedRecently, setCompletedRecently] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onJobCompletedRef = useRef(onJobCompleted);
  onJobCompletedRef.current = onJobCompleted;

  // Only poll while there's active work; otherwise rely on SSE job events
  const progressQuery = api.app.getSyncProgress.useQuery(
    { id: appId },
    {
      refetchInterval: (query) => {
        const d = query.state.data;
        if (!d) return 3000; // Initial fetch
        const active =
          d.status === "syncing" ||
          (d.running ?? 0) > 0 ||
          (d.pending ?? 0) > 0;
        return active ? 3000 : false;
      },
    },
  );

  const data = progressQuery.data;

  // Debounced refetch for photo gallery — batch multiple quick completions
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleGalleryRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      onJobCompletedRef.current?.();
    }, 2000);
  }, []);

  // Listen for job_update SSE events to trigger refetch
  useJobEvents({
    onEvent: (event) => {
      if (event.type === "job_update") {
        const payload = event.job.payload as Record<string, unknown>;
        if (payload?.appId === appId) {
          void progressQuery.refetch();
          // When a file_scrape job completes, schedule gallery refresh
          if (
            event.job.type === "file_scrape" &&
            event.job.status === "completed"
          ) {
            scheduleGalleryRefresh();
          }
        }
      }
    },
  });

  const {
    total = 0,
    completed = 0,
    running = 0,
    pending = 0,
    failed = 0,
  } = data ?? {};
  const active = total > 0 && (running > 0 || pending > 0);
  const isSyncing = data?.status === "syncing";

  // Show overlay when work begins, auto-hide 3s after completion
  useEffect(() => {
    if (active || isSyncing) {
      setDismissed(false);
      setCompletedRecently(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else if (total > 0 && !active && !isSyncing && !dismissed) {
      setCompletedRecently(true);
      hideTimerRef.current = setTimeout(() => {
        setDismissed(true);
        setCompletedRecently(false);
      }, 3000);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [active, isSyncing, total, dismissed]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleDismiss = useCallback(() => setDismissed(true), []);

  if (!data || dismissed) return null;
  if (!active && !isSyncing && !completedRecently) return null;

  const processed = completed + failed;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isDone = !active && !isSyncing && completedRecently;

  return (
    <div className="pointer-events-none sticky bottom-4 z-50 flex justify-end px-4">
      <div className="pointer-events-auto flex min-w-[240px] items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/80">
        {isDone ? (
          <CheckCircle size={16} className="shrink-0 text-green-400" />
        ) : (
          <LoadingOutlined size={16} className="shrink-0 text-orange-400" />
        )}

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              {isDone
                ? `已完成 ${processed} 项`
                : isSyncing && total === 0
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
              className={`h-full rounded-full transition-all duration-300 ${isDone ? "bg-green-500" : "bg-orange-500"}`}
              style={{ width: `${percent}%` }}
            />
          </div>

          {!isDone && running > 0 && (
            <span className="text-[11px] text-white/40">
              {running} 个任务运行中
              {pending > 0 && `，${pending} 个排队中`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
