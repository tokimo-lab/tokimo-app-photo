import dayjs from "dayjs";
import type { ReactNode } from "react";
import type { PhotoDetailOutput } from "../generated/rust-api";

const DEFAULT_LONG_FORMAT = "YYYY-MM-DD HH:mm:ss";

export const WEEKDAYS = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
];

export function formatMegapixels(w: number, h: number): string {
  const mp = (w * h) / 1_000_000;
  return mp >= 1 ? `${Math.round(mp)}MP` : `${mp.toFixed(1)}MP`;
}

function formatNum(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded);
}

export function formatCameraSettings(detail: PhotoDetailOutput): string | null {
  const parts: string[] = [];
  if (detail.aperture) parts.push(`ƒ/${formatNum(detail.aperture)}`);
  if (detail.shutterSpeed) parts.push(detail.shutterSpeed);
  if (detail.focalLength) parts.push(`${formatNum(detail.focalLength)}mm`);
  if (detail.iso) parts.push(`ISO${detail.iso}`);
  return parts.length > 0 ? parts.join("  ") : null;
}

export function getDirectoryPath(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf("/");
  return lastSlash >= 0 ? fullPath.substring(0, lastSlash) : fullPath;
}

export function formatDateLines(
  iso: string,
  fmt?: string,
): { dateLine: string; timeLine: string } | null {
  const d = dayjs(iso);
  if (!d.isValid()) return null;
  const formatted = d.format(fmt ?? DEFAULT_LONG_FORMAT);
  // Still show the weekday line alongside the formatted date
  const wd = WEEKDAYS[d.day()];
  return { dateLine: formatted, timeLine: wd };
}

export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-white/50">{label}</span>
      <p className="break-all text-white/90">{value}</p>
    </div>
  );
}

export function InfoSection({
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

export const EXTRA_EXIF_FIELDS: [string, string][] = [
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
