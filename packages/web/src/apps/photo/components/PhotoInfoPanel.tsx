import { useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CornerDownLeft,
  ExternalLink,
  FileText,
  MapPin,
  Pencil,
  Plus,
  ScanText,
  Search,
  SearchCode,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  PhotoDetailOutput,
  PhotoOcrResultItem,
} from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { getOcrModelName } from "@/lib/ocr-models";
import { ExifModal, stripExifQuotes } from "./ExifModal";
import { OcrDebugModal } from "./OcrDebugModal";
import { PhotoFacesPanel } from "./PhotoFacesPanel";
import { PhotoToolsPanel } from "./PhotoToolsPanel";
import { formatBytes } from "./photo-utils";

// ── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMegapixels(w: number, h: number): string {
  const mp = (w * h) / 1_000_000;
  return mp >= 1 ? `${Math.round(mp)}MP` : `${mp.toFixed(1)}MP`;
}

function formatNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded);
}

function formatCameraSettings(detail: PhotoDetailOutput): string | null {
  const parts: string[] = [];
  if (detail.aperture) parts.push(`ƒ/${formatNum(detail.aperture)}`);
  if (detail.shutterSpeed) parts.push(detail.shutterSpeed);
  if (detail.focalLength) parts.push(`${formatNum(detail.focalLength)}mm`);
  if (detail.iso) parts.push(`ISO${detail.iso}`);
  return parts.length > 0 ? parts.join("  ") : null;
}

function getDirectoryPath(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf("/");
  return lastSlash >= 0 ? fullPath.substring(0, lastSlash) : fullPath;
}

function formatDateLines(
  iso: string,
): { dateLine: string; timeLine: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAYS[d.getDay()];
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return { dateLine: `${m}月${day}日`, timeLine: `${wd}, ${h}:${min}` };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/50">{label}</span>
      <p className="break-all text-white/90">{value}</p>
    </div>
  );
}

function InfoSection({
  icon,
  title,
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
        {icon}
        <span className="flex-1">{title}</span>
        {actions}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── Extra EXIF field mapping ─────────────────────────────────────────────────

const EXTRA_EXIF_FIELDS: [string, string][] = [
  ["ExposureMode", "曝光模式"],
  ["WhiteBalance", "白平衡"],
  ["Flash", "闪光灯"],
  ["MeteringMode", "测光模式"],
  ["Software", "软件"],
  ["ExposureBiasValue", "曝光补偿"],
  ["ColorSpace", "色彩空间"],
  ["ExposureProgram", "曝光程序"],
  ["SceneCaptureType", "场景类型"],
  ["FocalLengthIn35mmFilm", "等效焦距"],
  ["PhotographicSensitivity", "感光度"],
  ["CompositeImage", "合成图像"],
  ["SensingMethod", "感光方式"],
];

// ── OCR result row with inline edit ──────────────────────────────────────────

function OcrResultRow({
  r,
  isHovered,
  isEditing,
  range,
  pendingBbox,
  onHover,
  onStartEdit,
  onFinishEdit,
  onDelete,
}: {
  r: PhotoOcrResultItem;
  isHovered: boolean;
  isEditing: boolean;
  range?: { start: number; end: number };
  pendingBbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null;
  onHover: (id: string | null) => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onDelete: () => void;
}) {
  const [editText, setEditText] = useState(r.text);
  const [itemHovered, setItemHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const updateMutation = api.photoSettings.updateOcrResult.useMutation();
  const deleteMutation = api.photoSettings.deleteOcrResult.useMutation();

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      setEditText(r.text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isEditing, r.text]);

  const invalidateOcr = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/{id}/ocr-results"],
    });
  }, [queryClient]);

  const handleSubmit = useCallback(() => {
    const trimmed = editText.trim();
    const textChanged = trimmed && trimmed !== r.text;
    const bboxChanged = pendingBbox != null;
    if (!textChanged && !bboxChanged) {
      onFinishEdit();
      return;
    }
    const payload: {
      ocrResultId: number;
      text?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      angle?: number;
      corners?: [number, number][];
    } = { ocrResultId: Number(r.id) };
    if (textChanged) payload.text = trimmed;
    if (bboxChanged) {
      const { angle: bboxAngle, corners: bboxCorners, ...coords } = pendingBbox;
      Object.assign(payload, coords);
      if (bboxAngle != null) payload.angle = bboxAngle;
      if (bboxCorners) payload.corners = bboxCorners;
    }
    updateMutation.mutate(payload, {
      onSuccess: invalidateOcr,
      onSettled: onFinishEdit,
    });
  }, [
    editText,
    r.id,
    r.text,
    pendingBbox,
    updateMutation,
    onFinishEdit,
    invalidateOcr,
  ]);

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(
      { ocrResultId: Number(r.id) },
      {
        onSuccess: () => {
          invalidateOcr();
          onDelete();
        },
      },
    );
  }, [deleteMutation, r.id, invalidateOcr, onDelete]);

  const textChars = Array.from(r.text);
  const hasRange = range && range.start < range.end;

  // Shared min-height to prevent visual jump between display / edit modes
  const rowClass = "rounded px-2 py-1 text-sm leading-relaxed min-h-[1.875rem]";

  if (isEditing) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: editable OCR row
      <div
        className={`${rowClass} flex items-center gap-1 bg-white/10`}
        onMouseEnter={() => onHover(r.id)}
        onMouseLeave={() => onHover(null)}
      >
        <input
          ref={inputRef}
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            else if (e.key === "Escape") onFinishEdit();
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          placeholder={r.text}
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          title="确认 (Enter)"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="shrink-0 rounded p-0.5 text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
          title="删除此识别区域"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onFinishEdit}
          className="shrink-0 rounded p-0.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          title="取消 (Esc)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: OCR row with hover tracking
    <div
      className={`${rowClass} flex cursor-default transition-colors ${
        isHovered
          ? "bg-emerald-400/15 text-white"
          : hasRange
            ? "bg-white/5 text-white"
            : "bg-white/5 text-white/80 hover:bg-white/10"
      }`}
      onMouseEnter={() => {
        setItemHovered(true);
        onHover(r.id);
      }}
      onMouseLeave={() => {
        setItemHovered(false);
        onHover(null);
      }}
    >
      <span className="min-w-0 flex-1 break-all">
        {hasRange ? (
          <>
            {textChars.slice(0, range.start).join("")}
            <mark className="rounded-sm bg-blue-400/30 text-white">
              {textChars.slice(range.start, range.end).join("")}
            </mark>
            {textChars.slice(range.end).join("")}
          </>
        ) : (
          r.text
        )}
      </span>
      {/* Right-aligned: confidence or manual indicator + edit icon */}
      <span className="ml-1 inline-flex shrink-0 items-center gap-1 self-center">
        {r.score != null ? (
          <span className="text-xs text-white/30">
            {Math.round(r.score * 100)}%
          </span>
        ) : (
          <span className="text-xs text-white/20" title="手动编辑">
            ✎
          </span>
        )}
        {itemHovered && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="inline-flex items-center rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
            title="编辑识别文字"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  );
}

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

  const { data: ocrResults } = api.photoSettings.getPhotoOcrResults.useQuery(
    { photoId: detail.id },
    { enabled: !!detail.id },
  );

  const { data: similarData } = api.photoSettings.similarPhotos.useQuery(
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
          <InfoSection icon={<Search className="h-3 w-3" />} title="相似照片">
            <div className="grid grid-cols-3 gap-1.5">
              {similarData.items.map((item) => (
                <div
                  key={item.photoId}
                  className="group relative aspect-square overflow-hidden rounded"
                >
                  <img
                    src={`/api/apps/photo/${item.photoId}/thumbnail?w=160`}
                    alt={item.filename}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-1 pb-0.5 pt-3 text-right">
                    <span className="text-[10px] font-medium text-white/80 tabular-nums">
                      {Math.round(item.similarity * 100)}%
                    </span>
                  </div>
                </div>
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
            <a
              href={`https://uri.amap.com/marker?position=${detail.gpsLongitude},${detail.gpsLatitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在高德地图中打开
            </a>
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
