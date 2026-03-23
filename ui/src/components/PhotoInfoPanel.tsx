import { Camera, ExternalLink, FileText, MapPin } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PhotoDetailOutput } from "../../generated/rust-api";
import { ExifModal, stripExifQuotes } from "./ExifModal";
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
      <p className="text-white/90">{value}</p>
    </div>
  );
}

function InfoSection({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
        {icon}
        {title}
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

// ── Main component ───────────────────────────────────────────────────────────

export function PhotoInfoPanel({
  detail,
  fallbackTitle,
  editForm,
}: {
  detail: PhotoDetailOutput;
  fallbackTitle: string;
  editForm: ReactNode | null;
}) {
  const [showExifModal, setShowExifModal] = useState(false);

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
        <h3 className="mb-4 text-base font-semibold">
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
      </div>

      {showExifModal && detail.exifData && (
        <ExifModal
          exifData={detail.exifData}
          onClose={() => setShowExifModal(false)}
        />
      )}
    </>
  );
}
