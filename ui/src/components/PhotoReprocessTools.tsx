import { Button, Modal, useToast } from "@tokimo/ui";
import {
  ImageDown,
  type LucideIcon,
  MapPin,
  ScanFace,
  ScanSearch,
  ScanText,
} from "lucide-react";
import { useState } from "react";
import { api } from "../generated/rust-api";

interface PhotoReprocessToolsProps {
  appId: string;
}

interface ToolDef {
  key: string;
  icon: LucideIcon;
  label: string;
  description: string;
  confirmTitle: string;
  confirmContent: string;
}

const TOOLS: ToolDef[] = [
  {
    key: "ocr",
    icon: ScanText,
    label: "重新识别文字 (OCR)",
    description: "清除所有文字识别结果并重新识别",
    confirmTitle: "确认重新识别文字？",
    confirmContent:
      "将删除该图库所有照片的文字识别结果，然后重新执行识别。此操作不可撤销。",
  },
  {
    key: "face",
    icon: ScanFace,
    label: "重新识别人脸",
    description: "清除所有人脸识别结果并重新识别",
    confirmTitle: "确认重新识别人脸？",
    confirmContent:
      "将删除该图库所有照片的人脸识别结果并重新执行识别。已命名的人物会保留，但需要重新关联。此操作不可撤销。",
  },
  {
    key: "clip",
    icon: ScanSearch,
    label: "重新识别图像 (CLIP)",
    description: "清除所有图像向量并重新生成",
    confirmTitle: "确认重新识别图像？",
    confirmContent:
      "将删除该图库所有照片的图像向量并重新生成。重新生成期间以图搜图功能暂不可用。此操作不可撤销。",
  },
  {
    key: "geo",
    icon: MapPin,
    label: "重新解析地理位置",
    description: "重新解析所有照片的 GPS 坐标为地名",
    confirmTitle: "确认重新解析地理位置？",
    confirmContent:
      "将对该图库所有照片重新执行地理位置解析，已有结果会被覆盖。此操作不可撤销。",
  },
  {
    key: "thumbnail",
    icon: ImageDown,
    label: "重新生成缩略图",
    description: "清除所有缩略图缓存，访问时自动重新生成",
    confirmTitle: "确认重新生成缩略图？",
    confirmContent:
      "将删除该图库所有照片的缩略图缓存。缩略图会在下次访问时自动重新生成，期间可能加载较慢。",
  },
];

export default function PhotoReprocessTools({
  appId,
}: PhotoReprocessToolsProps) {
  const toast = useToast();
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const clearOcr = api.photo.clearAppOcrResults.useMutation();
  const ocrScan = api.photo.ocrScan.useMutation();
  const clearFace = api.photo.clearFaceResults.useMutation();
  const faceDetect = api.photo.faceDetect.useMutation();
  const clearClip = api.photo.clearClipResults.useMutation();
  const clipEmbed = api.photo.clipEmbed.useMutation();
  const reverseGeocode = api.photo.reverseGeocode.useMutation();
  const clearThumbnails = api.photo.clearThumbnails.useMutation();

  const handleReprocess = (tool: ToolDef) => {
    Modal.confirm({
      title: tool.confirmTitle,
      content: <p className="text-sm text-fg-muted">{tool.confirmContent}</p>,
      okText: "确认执行",
      variant: "warning",
      onOk: async () => {
        setRunningKey(tool.key);
        try {
          switch (tool.key) {
            case "ocr":
              await clearOcr.mutateAsync({ id: appId });
              await ocrScan.mutateAsync({ id: appId });
              toast.success("文字重新识别已开始");
              break;
            case "face":
              await clearFace.mutateAsync({ id: appId });
              await faceDetect.mutateAsync({ id: appId });
              toast.success("人脸重新识别已开始");
              break;
            case "clip":
              await clearClip.mutateAsync({ id: appId });
              await clipEmbed.mutateAsync({ id: appId });
              toast.success("图像重新识别已开始");
              break;
            case "geo":
              await reverseGeocode.mutateAsync({ id: appId });
              toast.success("地理位置重新解析已开始");
              break;
            case "thumbnail":
              await clearThumbnails.mutateAsync({ id: appId });
              toast.success("缩略图已清除，访问时将自动重新生成");
              break;
          }
        } catch {
          toast.error("操作失败，请重试");
        } finally {
          setRunningKey(null);
        }
      },
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        清除指定类型的处理结果并重新执行，适用于更换模型或修复数据异常
      </p>
      {TOOLS.map((tool) => (
        <div
          key={tool.key}
          className="flex items-center justify-between rounded-lg border border-border-base px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <tool.icon className="h-5 w-5 shrink-0 text-fg-muted" />
            <div>
              <div className="text-sm font-medium">{tool.label}</div>
              <div className="text-xs text-fg-muted">{tool.description}</div>
            </div>
          </div>
          <Button
            size="small"
            loading={runningKey === tool.key}
            disabled={runningKey !== null}
            onClick={() => handleReprocess(tool)}
          >
            执行
          </Button>
        </div>
      ))}
    </div>
  );
}
