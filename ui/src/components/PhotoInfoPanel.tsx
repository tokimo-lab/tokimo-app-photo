import {
  Camera,
  ChevronDown,
  ChevronRight,
  FileText,
  MapPin,
  Tags,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { PhotoDetailOutput } from "../../generated/rust-api";
import { formatBytes } from "./photo-utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMegapixels(w: number, h: number): string {
  const mp = (w * h) / 1_000_000;
  return mp >= 1 ? `${Math.round(mp)}MP` : `${mp.toFixed(1)}MP`;
}

function formatCameraSettings(detail: PhotoDetailOutput): string | null {
  const parts: string[] = [];
  if (detail.aperture) parts.push(`ƒ/${detail.aperture}`);
  if (detail.shutterSpeed) parts.push(detail.shutterSpeed);
  if (detail.focalLength) parts.push(`${detail.focalLength}mm`);
  if (detail.iso) parts.push(`ISO${detail.iso}`);
  return parts.length > 0 ? parts.join("  ") : null;
}

function getDirectoryPath(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf("/");
  return lastSlash >= 0 ? fullPath.substring(0, lastSlash) : fullPath;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = d.getHours().toString().padStart(2, "0");
  const min = d.getMinutes().toString().padStart(2, "0");
  return `${y}年${m}月${day}日 ${h}:${min}`;
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
  const [showRawExif, setShowRawExif] = useState(false);

  const hasCameraData =
    detail.cameraMake ||
    detail.cameraModel ||
    detail.lensModel ||
    detail.aperture ||
    detail.shutterSpeed ||
    detail.focalLength ||
    detail.iso;

  const hasGps = detail.gpsLatitude != null && detail.gpsLongitude != null;
  const cameraSettings = formatCameraSettings(detail);

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
          {detail.takenAt && (
            <InfoRow label="日期" value={formatDate(detail.takenAt)} />
          )}
          {detail.width && detail.height && (
            <div>
              <span className="text-white/50">分辨率</span>
              <p className="text-white/90">
                {formatMegapixels(detail.width, detail.height)}
                {" · "}
                {detail.width}×{detail.height}
                {detail.fileSize && ` · ${formatBytes(detail.fileSize)}`}
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
            {detail.lensModel && (
              <InfoRow label="镜头" value={detail.lensModel} />
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
                const v = detail.exifData?.[key];
                return v ? <InfoRow key={key} label={label} value={v} /> : null;
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
          </InfoSection>
        )}

        {/* ── Raw EXIF section ────────────────────────────────────── */}
        {detail.exifData && Object.keys(detail.exifData).length > 0 && (
          <div className="border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setShowRawExif((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40 hover:text-white/60"
            >
              {showRawExif ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Tags className="h-3 w-3" />
              EXIF 原始数据
            </button>
            {showRawExif && (
              <div className="mt-2 max-h-72 space-y-px overflow-y-auto rounded bg-white/5 p-2 font-mono text-xs">
                {Object.keys(detail.exifData)
                  .sort()
                  .map((key, i) => (
                    <div
                      key={key}
                      className={`flex justify-between gap-3 rounded px-1.5 py-0.5 ${
                        i % 2 === 0 ? "bg-white/5" : ""
                      }`}
                    >
                      <span className="shrink-0 text-white/40">{key}</span>
                      <span className="truncate text-right text-white/80">
                        {detail.exifData![key]}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
