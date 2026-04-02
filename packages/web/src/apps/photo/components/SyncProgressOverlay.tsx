import { LoadingOutlined } from "@tokiomo/components";
import { AlertCircle, CheckCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useJobEvents } from "@/system/events/useJobEvents";

interface SyncProgressOverlayProps {
  appId: string;
  /** Called when a file_scrape job completes, so the gallery can refresh */
  onJobCompleted?: () => void;
}

const TASK_LABELS: Record<string, string> = {
  file_scrape: "文件扫描",
  photo_ocr: "文字识别",
  photo_clip: "图像识别",
  photo_face_detect: "人脸识别",
  photo_reverse_geocode: "地理位置",
};

function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
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

  // Only poll while there's active work; otherwise rely on WS job events
  const progressQuery = api.app.getSyncProgress.useQuery(
    { id: appId },
    {
      refetchInterval: (query) => {
        const d = query.state.data;
        if (!d) return 3000;
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

  // Listen for job_update WS events to trigger refetch
  useJobEvents({
    onEvent: (event) => {
      if (event.type === "job_update") {
        const payload = event.job.payload as Record<string, unknown>;
        if (payload?.appId === appId) {
          void progressQuery.refetch();
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

  const { running = 0, pending = 0 } = data ?? {};
  const tasks = data?.tasks ?? [];
  const active = running > 0 || pending > 0;
  const isSyncing = data?.status === "syncing";

  // Filter tasks to show: running/pending tasks, or recently failed
  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "pending",
  );
  const failedTasks = tasks.filter((t) => t.status === "failed");

  // Show overlay when work begins, auto-hide 3s after completion
  useEffect(() => {
    if (active || isSyncing) {
      setDismissed(false);
      setCompletedRecently(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else if (tasks.length > 0 && !active && !isSyncing && !dismissed) {
      setCompletedRecently(true);
      hideTimerRef.current = setTimeout(() => {
        setDismissed(true);
        setCompletedRecently(false);
      }, 3000);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [active, isSyncing, tasks.length, dismissed]);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const handleDismiss = useCallback(() => setDismissed(true), []);

  if (!data || dismissed) return null;
  if (!active && !isSyncing && !completedRecently) return null;

  const isDone = !active && !isSyncing && completedRecently;

  return (
    <div className="pointer-events-none sticky bottom-4 z-50 flex justify-end px-4">
      <div className="pointer-events-auto flex min-w-[260px] max-w-[340px] flex-col gap-2 rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-neutral-900/80">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isDone ? (
              <CheckCircle size={14} className="shrink-0 text-green-400" />
            ) : (
              <LoadingOutlined size={14} className="shrink-0 text-orange-400" />
            )}
            <span className="font-medium">
              {isDone
                ? "处理完成"
                : isSyncing && activeTasks.length === 0
                  ? "正在扫描文件…"
                  : "处理中"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded p-0.5 text-white/40 hover:text-white/80"
          >
            <X size={14} />
          </button>
        </div>

        {/* Per-task progress */}
        {!isDone &&
          activeTasks.map((task) => {
            const label = TASK_LABELS[task.taskType] ?? task.taskType;
            const pct =
              task.totalItems > 0
                ? Math.round((task.processedItems / task.totalItems) * 100)
                : 0;
            const isPending = task.status === "pending";
            return (
              <div key={task.taskType} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70">{label}</span>
                  <span className="tabular-nums text-white/50">
                    {isPending
                      ? "等待中"
                      : task.totalItems > 0
                        ? `${formatCount(task.processedItems)}/${formatCount(task.totalItems)}`
                        : "处理中…"}
                  </span>
                </div>
                {!isPending && task.totalItems > 0 && (
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-orange-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}

        {/* Failed tasks summary */}
        {!isDone && failedTasks.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-400/80">
            <AlertCircle size={12} className="shrink-0" />
            <span>
              {failedTasks
                .map((t) => TASK_LABELS[t.taskType] ?? t.taskType)
                .join("、")}
              {" 失败"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
