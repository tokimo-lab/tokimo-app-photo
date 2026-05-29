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
import { api } from "../api/client";
import { getPhotoI18n, type PhotoI18nKey } from "../i18n";

interface PhotoReprocessToolsProps {
  appId: string;
  locale?: string;
}

interface ToolDef {
  key: string;
  icon: LucideIcon;
  labelKey: PhotoI18nKey;
  descKey: PhotoI18nKey;
  confirmTitleKey: PhotoI18nKey;
  confirmContentKey: PhotoI18nKey;
  successKey: PhotoI18nKey;
}

const TOOL_DEFS: ToolDef[] = [
  {
    key: "ocr",
    icon: ScanText,
    labelKey: "reprocessOcrLabel",
    descKey: "reprocessOcrDesc",
    confirmTitleKey: "reprocessOcrConfirmTitle",
    confirmContentKey: "reprocessOcrConfirmContent",
    successKey: "reprocessOcrSuccess",
  },
  {
    key: "face",
    icon: ScanFace,
    labelKey: "reprocessFaceLabel",
    descKey: "reprocessFaceDesc",
    confirmTitleKey: "reprocessFaceConfirmTitle",
    confirmContentKey: "reprocessFaceConfirmContent",
    successKey: "reprocessFaceSuccess",
  },
  {
    key: "clip",
    icon: ScanSearch,
    labelKey: "reprocessClipLabel",
    descKey: "reprocessClipDesc",
    confirmTitleKey: "reprocessClipConfirmTitle",
    confirmContentKey: "reprocessClipConfirmContent",
    successKey: "reprocessClipSuccess",
  },
  {
    key: "geo",
    icon: MapPin,
    labelKey: "reprocessGeoLabel",
    descKey: "reprocessGeoDesc",
    confirmTitleKey: "reprocessGeoConfirmTitle",
    confirmContentKey: "reprocessGeoConfirmContent",
    successKey: "reprocessGeoSuccess",
  },
  {
    key: "thumbnail",
    icon: ImageDown,
    labelKey: "reprocessThumbnailLabel",
    descKey: "reprocessThumbnailDesc",
    confirmTitleKey: "reprocessThumbnailConfirmTitle",
    confirmContentKey: "reprocessThumbnailConfirmContent",
    successKey: "reprocessThumbnailSuccess",
  },
];

export default function PhotoReprocessTools({
  appId,
  locale,
}: PhotoReprocessToolsProps) {
  const { t } = getPhotoI18n(locale);
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
      title: t(tool.confirmTitleKey),
      content: <p className="text-sm text-fg-muted">{t(tool.confirmContentKey)}</p>,
      okText: t("reprocessConfirmOk"),
      variant: "warning",
      onOk: async () => {
        setRunningKey(tool.key);
        try {
          switch (tool.key) {
            case "ocr":
              await clearOcr.mutateAsync({ id: appId });
              await ocrScan.mutateAsync({ id: appId });
              break;
            case "face":
              await clearFace.mutateAsync({ id: appId });
              await faceDetect.mutateAsync({ id: appId });
              break;
            case "clip":
              await clearClip.mutateAsync({ id: appId });
              await clipEmbed.mutateAsync({ id: appId });
              break;
            case "geo":
              await reverseGeocode.mutateAsync({ id: appId });
              break;
            case "thumbnail":
              await clearThumbnails.mutateAsync({ id: appId });
              break;
          }
          toast.success(t(tool.successKey));
        } catch (err) {
          const message = err instanceof Error ? err.message : t("reprocessFailed");
          toast.error(message || t("reprocessFailed"));
        } finally {
          setRunningKey(null);
        }
      },
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">
        {t("reprocessSectionHint")}
      </p>
      {TOOL_DEFS.map((tool) => (
        <div
          key={tool.key}
          className="flex items-center justify-between rounded-lg border border-border-base px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <tool.icon className="h-5 w-5 shrink-0 text-fg-muted" />
            <div>
              <div className="text-sm font-medium">{t(tool.labelKey)}</div>
              <div className="text-xs text-fg-muted">{t(tool.descKey)}</div>
            </div>
          </div>
          <Button
            size="small"
            loading={runningKey === tool.key}
            disabled={runningKey !== null}
            onClick={() => handleReprocess(tool)}
          >
            {t("reprocessExecute")}
          </Button>
        </div>
      ))}
    </div>
  );
}
