import { LoadingOutlined } from "@tokimo/ui";
import {
  Image,
  RefreshCw,
  ScanFace,
  ScanText,
  Search,
  Tags,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useAppEvent } from "@/system";

type ToolKey = "faces" | "exif" | "thumbnail" | "clip" | "ocr";

interface ToolItem {
  key: ToolKey;
  label: string;
  icon: React.ReactNode;
}

const TOOLS: ToolItem[] = [
  {
    key: "faces",
    label: "人脸识别",
    icon: <ScanFace className="h-3.5 w-3.5" />,
  },
  { key: "exif", label: "EXIF", icon: <RefreshCw className="h-3.5 w-3.5" /> },
  {
    key: "thumbnail",
    label: "缩略图",
    icon: <Image className="h-3.5 w-3.5" />,
  },
  { key: "clip", label: "智能识图", icon: <Search className="h-3.5 w-3.5" /> },
  { key: "ocr", label: "OCR", icon: <ScanText className="h-3.5 w-3.5" /> },
];

// Tool keys whose refresh is now queued as an async job on the backend.
// For these we keep the loading spinner until a matching job_update with a
// terminal status arrives on the WS stream.
const ASYNC_TOOLS = new Set<ToolKey>(["faces", "clip", "ocr"]);

const TERMINAL_STATUSES = new Set([
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
]);

export function PhotoToolsPanel({
  photoId,
  onRefreshComplete,
}: {
  photoId: string;
  onRefreshComplete?: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  // Map jobId → ToolKey for in-flight async refreshes so job_update events
  // can route back to the correct row.
  const pendingJobs = useRef<Map<string, ToolKey>>(new Map());

  const refreshFaces = api.photo.refreshFaces.useMutation();
  const refreshExif = api.photo.refreshExif.useMutation();
  const refreshThumbnail = api.photo.refreshThumbnail.useMutation();
  const refreshClip = api.photo.refreshClip.useMutation();
  const refreshOcr = api.photo.refreshOcr.useMutation();

  useAppEvent((event) => {
    if (event.type !== "job_update") return;
    const tool = pendingJobs.current.get(event.job.id);
    if (!tool) return;
    const status = event.job.status;
    if (!TERMINAL_STATUSES.has(status)) return;

    pendingJobs.current.delete(event.job.id);
    setLoading((prev) => ({ ...prev, [tool]: false }));
    if (status === "failed" || status === "cancelled") {
      const msg =
        event.job.error ?? (status === "cancelled" ? "已中断" : "失败");
      setResults((prev) => ({ ...prev, [tool]: `❌ ${msg}` }));
    } else {
      setResults((prev) => ({ ...prev, [tool]: "✅ 已完成" }));
      onRefreshComplete?.();
    }
  });

  const handleRefresh = useCallback(
    (key: ToolKey) => {
      setLoading((prev) => ({ ...prev, [key]: true }));
      setResults((prev) => ({ ...prev, [key]: "" }));

      const onSyncSuccess = (msg: string) => {
        setLoading((prev) => ({ ...prev, [key]: false }));
        setResults((prev) => ({ ...prev, [key]: msg }));
        onRefreshComplete?.();
      };
      const onAsyncEnqueued = (jobId: string) => {
        // Keep the spinner until job_update reports a terminal status.
        pendingJobs.current.set(jobId, key);
      };
      const onError = (err: unknown) => {
        setLoading((prev) => ({ ...prev, [key]: false }));
        const msg = err instanceof Error ? err.message : "失败";
        setResults((prev) => ({ ...prev, [key]: `❌ ${msg}` }));
      };

      switch (key) {
        case "faces":
          refreshFaces.mutate(
            { photoId },
            {
              onSuccess: (data) => onAsyncEnqueued(data.jobId),
              onError,
            },
          );
          break;
        case "exif":
          refreshExif.mutate(
            { photoId },
            { onSuccess: () => onSyncSuccess("✅ 已刷新"), onError },
          );
          break;
        case "thumbnail":
          refreshThumbnail.mutate(
            { photoId },
            { onSuccess: () => onSyncSuccess("✅ 已清除缓存"), onError },
          );
          break;
        case "clip":
          refreshClip.mutate(
            { photoId },
            {
              onSuccess: (data) => onAsyncEnqueued(data.jobId),
              onError,
            },
          );
          break;
        case "ocr":
          refreshOcr.mutate(
            { photoId },
            {
              onSuccess: (data) => onAsyncEnqueued(data.jobId),
              onError,
            },
          );
          break;
      }
    },
    [
      photoId,
      refreshFaces,
      refreshExif,
      refreshThumbnail,
      refreshClip,
      refreshOcr,
      onRefreshComplete,
    ],
  );

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
        <Tags className="h-3 w-3" />
        工具
        {ASYNC_TOOLS.size > 0 && pendingJobs.current.size > 0 && (
          <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-white/30">
            后台运行中…
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            type="button"
            disabled={!!loading[tool.key]}
            onClick={() => handleRefresh(tool.key)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-white/8 px-2.5 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/15 hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-50"
            title={`刷新${tool.label}`}
          >
            {loading[tool.key] ? (
              <LoadingOutlined className="h-3.5 w-3.5" />
            ) : (
              tool.icon
            )}
            {tool.label}
          </button>
        ))}
      </div>
      {Object.entries(results).map(
        ([key, msg]) =>
          msg && (
            <p key={key} className="mt-1 text-xs text-white/50">
              {TOOLS.find((t) => t.key === key)?.label}: {msg}
            </p>
          ),
      )}
    </div>
  );
}
