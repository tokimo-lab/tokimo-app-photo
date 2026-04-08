import {
  Camera,
  ChevronRight,
  FileText,
  MapPin,
  Plus,
  ScanText,
  Search,
  SearchCode,
  Sparkles,
  Tag,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { PhotoDetailOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { getOcrModelName } from "@/lib/ocr-models";
import { thumbUrl } from "@/lib/thumb";
import { useWindowActions } from "@/system";
import { ExifModal, stripExifQuotes } from "./ExifModal";
import {
  EXTRA_EXIF_FIELDS,
  formatCameraSettings,
  formatDateLines,
  formatMegapixels,
  getDirectoryPath,
  InfoRow,
  InfoSection,
} from "./info-panel-helpers";
import { OcrDebugModal } from "./OcrDebugModal";
import { OcrResultRow } from "./OcrResultRow";
import { PhotoFacesPanel } from "./PhotoFacesPanel";
import { PhotoMiniMap } from "./PhotoMiniMap";
import { PhotoToolsPanel } from "./PhotoToolsPanel";
import { formatBytes } from "./photo-utils";

// ── Main component ───────────────────────────────────────────────────────────

export function PhotoInfoPanel({
  detail,
  fallbackTitle,
  editForm,
  hoveredFaceId,
  onHoverFace,
  hoveredOcrId,
  onHoverOcr,
  ocrSelectionRanges,
  onRefreshComplete,
  onNavigateToPerson,
  editingOcrId,
  onEditOcr,
  pendingBbox,
  onAddOcr,
}: {
  detail: PhotoDetailOutput;
  fallbackTitle: string;
  editForm: ReactNode | null;
  hoveredFaceId: number | null;
  onHoverFace: (faceId: number | null) => void;
  hoveredOcrId?: string | null;
  onHoverOcr?: (ocrId: string | null) => void;
  ocrSelectionRanges?: Map<string, { start: number; end: number }>;
  onRefreshComplete?: () => void;
  onNavigateToPerson?: (personId: string) => void;
  editingOcrId?: string | null;
  onEditOcr?: (ocrId: string | null) => void;
  pendingBbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null;
  onAddOcr?: () => void;
}) {
  const [showExifModal, setShowExifModal] = useState(false);
  const [showOcrDebug, setShowOcrDebug] = useState(false);
  const { openWindow } = useWindowActions();

  const handleViewNearby = useCallback(
    (selection: import("./PhotoMapView").MapClusterSelection) => {
      openWindow({
        type: "page",
        appId: detail.appId,
        title: selection.label,
        metadata: {
          appId: detail.appId,
          tab: "locations",
          locationBbox: selection,
        },
        forceNew: true,
      });
    },
    [openWindow, detail.appId],
  );

  const { data: ocrResults } = api.photo.getPhotoOcrResults.useQuery(
    { photoId: detail.id },
    { enabled: !!detail.id },
  );

  const { data: similarData } = api.photo.similarPhotos.useQuery(
    { photoId: detail.id },
    { enabled: !!detail.id },
  );

  const { data: tagsData } = api.photo.photoTags.useQuery(
    { photoId: detail.id },
    { enabled: !!detail.id },
  );

  const hasCameraData =
    detail.cameraMake ||
    detail.cameraModel ||
    detail.lensModel ||
    detail.exifData?.LensModel ||
    detail.aperture ||
    detail.shutterSpeed ||
    detail.focalLength ||
    detail.iso;

  const hasGps = detail.gpsLatitude != null && detail.gpsLongitude != null;
  const cameraSettings = formatCameraSettings(detail);
  const effectiveLensModel =
    detail.lensModel ??
    (detail.exifData?.LensModel
      ? stripExifQuotes(detail.exifData.LensModel)
      : null);
  const dateLines = detail.takenAt ? formatDateLines(detail.takenAt) : null;

  return (
    <>
      {/* Title / edit form */}
      {editForm ?? (
        <h3 className="mb-4 break-all text-base font-semibold">
          {detail.title || fallbackTitle}
        </h3>
      )}

      <div className="space-y-4">
        {/* ── Details section ─────────────────────────────────────── */}
        <InfoSection icon={<FileText className="h-3 w-3" />} title="详情">
          {dateLines && (
            <div>
              <p className="text-lg font-bold text-white/90">
                {dateLines.dateLine}
              </p>
              <p className="text-sm text-white/50">{dateLines.timeLine}</p>
            </div>
          )}
          {detail.width && detail.height && (
            <div>
              <span className="text-white/50">分辨率</span>
              <p className="text-white/90">
                {formatMegapixels(detail.width, detail.height)}
                {"\u2003"}
                {detail.width}×{detail.height}
                {detail.fileSize != null && (
                  <>
                    {"\u2003"}
                    {formatBytes(detail.fileSize)} (
                    {detail.fileSize.toLocaleString()} bytes)
                  </>
                )}
              </p>
            </div>
          )}
          {!detail.width && detail.fileSize && (
            <InfoRow label="文件大小" value={formatBytes(detail.fileSize)} />
          )}
          <InfoRow label="文件名" value={detail.filename} />
          {detail.path && (
            <InfoRow label="路径" value={getDirectoryPath(detail.path)} />
          )}
          {detail.mimeType && <InfoRow label="类型" value={detail.mimeType} />}
          {detail.exifData?.DateTime && (
            <InfoRow
              label="修改时间"
              value={stripExifQuotes(detail.exifData.DateTime)}
            />
          )}
          {detail.exifData && Object.keys(detail.exifData).length > 0 && (
            <button
              type="button"
              onClick={() => setShowExifModal(true)}
              className="mt-1 cursor-pointer rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/15 hover:text-white/90"
            >
              查看 EXIF 原始数据
            </button>
          )}
        </InfoSection>

        {/* ── People section ──────────────────────────────────────── */}
        <PhotoFacesPanel
          photoId={detail.id}
          appId={detail.appId}
          photoWidth={detail.width}
          photoHeight={detail.height}
          hoveredFaceId={hoveredFaceId}
          onHoverFace={onHoverFace}
          onNavigateToPerson={onNavigateToPerson}
        />

        {/* ── Similar photos (CLIP) section ────────────────────────── */}
        {similarData?.indexed && similarData.items.length > 0 && (
          <InfoSection
            icon={<Search className="h-3 w-3" />}
            title="相似照片"
            actions={
              <button
                type="button"
                onClick={() => {
                  openWindow({
                    type: "page",
                    appId: detail.appId,
                    title: "相似照片",
                    metadata: {
                      appId: detail.appId,
                      tab: "timeline",
                      similarSourceId: detail.id,
                    },
                    forceNew: true,
                  });
                }}
                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/70"
              >
                更多
                <ChevronRight className="h-3 w-3" />
              </button>
            }
          >
            <div className="grid grid-cols-3 gap-1.5">
              {similarData.items.map((item) => (
                <button
                  type="button"
                  key={item.photoId}
                  className="group relative aspect-square overflow-hidden rounded cursor-pointer"
                  onClick={() => {
                    openWindow({
                      type: "image",
                      title: item.filename,
                      route: `/photos/${item.photoId}`,
                      appId: detail.appId,
                      sourceType: "photo",
                      sourceId: item.photoId,
                    });
                  }}
                >
                  <img
                    src={thumbUrl("photo", item.photoId, 160)}
                    alt={item.filename}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-1 pb-0.5 pt-3 text-right">
                    <span className="text-[10px] font-medium text-white/80 tabular-nums">
                      {Math.round(item.similarity * 100)}%
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </InfoSection>
        )}

        {/* ── AI Tags (CLIP zero-shot) section ────────────────────── */}
        {tagsData?.indexed && tagsData.tags.length > 0 && (
          <InfoSection icon={<Tag className="h-3 w-3" />} title="智能标签">
            <div className="flex flex-wrap gap-1.5">
              {tagsData.tags.map((tag) => (
                <button
                  type="button"
                  key={`${tag.category}-${tag.subcategory}`}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                  title={`${tag.category} · ${tag.subcategory} (${Math.round(tag.score * 100)}%)`}
                  onClick={() => {
                    openWindow({
                      type: "page",
                      appId: detail.appId,
                      title: `${tag.icon} ${tag.subcategory}`,
                      metadata: {
                        appId: detail.appId,
                        tab: "timeline",
                        tagFilter: {
                          category: tag.category,
                          subcategory: tag.subcategory,
                          icon: tag.icon,
                        },
                      },
                      forceNew: true,
                    });
                  }}
                >
                  <span>{tag.icon}</span>
                  <span>{tag.subcategory}</span>
                </button>
              ))}
            </div>
          </InfoSection>
        )}

        {/* ── Camera section ──────────────────────────────────────── */}
        {hasCameraData && (
          <InfoSection icon={<Camera className="h-3 w-3" />} title="相机">
            {(detail.cameraMake || detail.cameraModel) && (
              <InfoRow
                label="相机"
                value={[detail.cameraMake, detail.cameraModel]
                  .filter(Boolean)
                  .join(" ")}
              />
            )}
            {effectiveLensModel && (
              <InfoRow label="镜头" value={effectiveLensModel} />
            )}
            {cameraSettings && (
              <div>
                <span className="text-white/50">参数</span>
                <p className="font-mono text-sm tracking-wide text-white/90">
                  {cameraSettings}
                </p>
              </div>
            )}
            {detail.exifData &&
              EXTRA_EXIF_FIELDS.map(([key, label]) => {
                const raw = detail.exifData?.[key];
                if (!raw) return null;
                const cleaned = stripExifQuotes(raw);
                if (
                  key === "PhotographicSensitivity" &&
                  detail.iso != null &&
                  cleaned === String(detail.iso)
                ) {
                  return null;
                }
                const display =
                  key === "FocalLengthIn35mmFilm" ? `${cleaned}mm` : cleaned;
                return <InfoRow key={key} label={label} value={display} />;
              })}
          </InfoSection>
        )}

        {/* ── Location section ────────────────────────────────────── */}
        {hasGps && (
          <InfoSection icon={<MapPin className="h-3 w-3" />} title="位置">
            <InfoRow
              label="坐标"
              value={`${detail.gpsLatitude!.toFixed(6)}, ${detail.gpsLongitude!.toFixed(6)}`}
            />
            {detail.gpsAltitude != null && (
              <InfoRow
                label="海拔"
                value={`${Math.round(detail.gpsAltitude)}m`}
              />
            )}
            {detail.locationName && (
              <InfoRow label="地点" value={detail.locationName} />
            )}
            {detail.geoAddress && detail.geoAddress !== detail.locationName && (
              <InfoRow label="详细地址" value={detail.geoAddress} />
            )}
            {detail.geoProvince && (
              <InfoRow
                label="行政区划"
                value={[
                  detail.geoProvince,
                  detail.geoCity,
                  detail.geoDistrict,
                  detail.geoTownship,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              />
            )}
            <PhotoMiniMap
              appId={detail.appId}
              latitude={detail.gpsLatitude!}
              longitude={detail.gpsLongitude!}
              onViewNearby={handleViewNearby}
            />
          </InfoSection>
        )}

        {/* ── OCR text section ──────────────────────────────────── */}
        {ocrResults && ocrResults.length > 0 && (
          <InfoSection
            icon={<ScanText className="h-3 w-3" />}
            title="文字识别"
            actions={
              <button
                type="button"
                onClick={() => onAddOcr?.()}
                className="rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
                title="手动新增识别区域"
              >
                <Plus className="h-3 w-3" />
              </button>
            }
          >
            <div className="space-y-1.5">
              {ocrResults.map((r) => (
                <OcrResultRow
                  key={r.id}
                  r={r}
                  isHovered={hoveredOcrId === r.id}
                  isEditing={editingOcrId === r.id}
                  range={ocrSelectionRanges?.get(r.id)}
                  pendingBbox={editingOcrId === r.id ? pendingBbox : undefined}
                  onHover={(id) => onHoverOcr?.(id)}
                  onStartEdit={() => onEditOcr?.(r.id)}
                  onFinishEdit={() => onEditOcr?.(null)}
                  onDelete={() => onEditOcr?.(null)}
                />
              ))}
            </div>
            {detail.ocrScannedAt && (
              <p className="mt-2 flex items-center gap-1 text-xs text-white/30">
                <span>
                  识别于 {new Date(detail.ocrScannedAt).toLocaleString("zh-CN")}
                  {(() => {
                    const modelName = getOcrModelName(
                      ocrResults[0]?.modelName ?? null,
                    );
                    return modelName ? ` · 识别模型: ${modelName}` : null;
                  })()}
                  {(() => {
                    const TIER_LABELS: Record<string, string> = {
                      attention: "Attention 对齐",
                      ctc: "CTC 对齐",
                      canvas: "比例估算",
                    };
                    const types = [
                      ...new Set(
                        ocrResults.map((r) => r.positioningType ?? "canvas"),
                      ),
                    ];
                    if (types.length === 1) {
                      return ` · 定位: ${TIER_LABELS[types[0]] ?? types[0]}`;
                    }
                    const best = types.includes("attention")
                      ? "attention"
                      : types.includes("ctc")
                        ? "ctc"
                        : "canvas";
                    return ` · 定位: ${TIER_LABELS[best]} (混合)`;
                  })()}
                </span>
                {detail.ocrDebugInfo && (
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
                    title="查看多模型识别详情"
                    onClick={() => setShowOcrDebug(true)}
                  >
                    <SearchCode className="h-3 w-3" />
                  </button>
                )}
              </p>
            )}
          </InfoSection>
        )}

        {/* ── AI recognition section ─────────────────────────────── */}
        {detail.description && (
          <InfoSection icon={<Sparkles className="h-3 w-3" />} title="智能描述">
            <p className="text-sm leading-relaxed text-white/80">
              {detail.description}
            </p>
          </InfoSection>
        )}

        {/* ── Tools section ───────────────────────────────────────── */}
        <PhotoToolsPanel
          photoId={detail.id}
          onRefreshComplete={onRefreshComplete}
        />
      </div>

      {showExifModal && detail.exifData && (
        <ExifModal
          exifData={detail.exifData}
          onClose={() => setShowExifModal(false)}
        />
      )}

      {showOcrDebug && detail.ocrDebugInfo && ocrResults && (
        <OcrDebugModal
          debugInfo={detail.ocrDebugInfo}
          mergedTexts={ocrResults.map((r) => r.text)}
          onClose={() => setShowOcrDebug(false)}
        />
      )}
    </>
  );
}
