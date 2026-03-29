import { LoadingOutlined } from "@tokiomo/components";
import {
  Image,
  RefreshCw,
  ScanFace,
  ScanText,
  Search,
  Tags,
} from "lucide-react";
import { useCallback, useState } from "react";
import { api } from "../../generated/rust-api";

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

export function PhotoToolsPanel({
  photoId,
  onRefreshComplete,
}: {
  photoId: string;
  onRefreshComplete?: () => void;
}) {
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  const refreshFaces = api.photoSettings.refreshFaces.useMutation();
  const refreshExif = api.photoSettings.refreshExif.useMutation();
  const refreshThumbnail = api.photoSettings.refreshThumbnail.useMutation();
  const refreshClip = api.photoSettings.refreshClip.useMutation();
  const refreshOcr = api.photoSettings.refreshOcr.useMutation();

  const handleRefresh = useCallback(
    (key: ToolKey) => {
      setLoading((prev) => ({ ...prev, [key]: true }));
      setResults((prev) => ({ ...prev, [key]: "" }));

      const onSuccess = (msg: string) => {
        setLoading((prev) => ({ ...prev, [key]: false }));
        setResults((prev) => ({ ...prev, [key]: msg }));
        onRefreshComplete?.();
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
              onSuccess: (data) =>
                onSuccess(`✅ 检测到 ${data.faceCount} 张人脸`),
              onError,
            },
          );
          break;
        case "exif":
          refreshExif.mutate(
            { photoId },
            { onSuccess: () => onSuccess("✅ 已刷新"), onError },
          );
          break;
        case "thumbnail":
          refreshThumbnail.mutate(
            { photoId },
            { onSuccess: () => onSuccess("✅ 已清除缓存"), onError },
          );
          break;
        case "clip":
          refreshClip.mutate(
            { photoId },
            { onSuccess: () => onSuccess("✅ 已刷新"), onError },
          );
          break;
        case "ocr":
          refreshOcr.mutate(
            { photoId },
            {
              onSuccess: (data) => onSuccess(`✅ 识别 ${data.ocrCount} 段文字`),
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
