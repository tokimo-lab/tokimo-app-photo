import { LayoutDashboard } from "lucide-react";
import type { ReactNode } from "react";
import type { TaskMetadata } from "@tokimo/sdk";
import { posterThumbUrl } from "../../../lib/thumb";
import { AppIcon } from "./AppIcon";
import { MaterialFileIcon } from "./MaterialFileIcon";

/** Window type string (matches shell's WindowType union). */
type WindowType = string;

/**
 * Window types that resolve to static PNG icons (not in PAGE_REGISTRY).
 */
const WINDOW_TYPE_ICON_IMAGE: Partial<Record<WindowType, string>> = {
  terminal: "/page-icons/terminal.png",
  database: "/page-icons/database.png",
};

/** Render a static PNG icon image */
function StaticIcon({ src, size }: { src: string; size: number }) {
  return (
    <img src={src} alt="" width={size} height={size} className="shrink-0" />
  );
}

export interface WindowIconOptions {
  type: WindowType;
  size?: number;
  /** Pass the full window metadata — icon URL is resolved automatically */
  metadata?: TaskMetadata;
  appIcon?: string;
  appColor?: string;
}

/**
 * Resolve the effective custom icon URL from window metadata.
 *
 * Centralises fallback logic so every consumer (title bar, taskbar, dock,
 * preview) gets the same icon without having to replicate the resolution.
 */
export function resolveWindowIconUrl(
  type: WindowType,
  metadata?: TaskMetadata,
): string | undefined {
  if (metadata?.windowIconUrl) return metadata.windowIconUrl;
  if (type === "video-player" && metadata?.playerMeta?.poster) {
    return posterThumbUrl(metadata.playerMeta.poster, 48);
  }
  return undefined;
}

/**
 * Resolve the icon for a window based on its type and metadata.
 *
 * Resolution order:
 *   0. Custom icon URL (e.g. movie/TV show poster set via windowIconUrl metadata)
 *   1. Built-in window types (terminal, database) → hardcoded PNG path
 *   2. App windows → AppIcon with user-defined icon/color
 *   3. System windows → PAGE_REGISTRY image or fallback to parent manifest icon
 *   4. File-based windows → MaterialFileIcon by filename or type extension
 */
export function getWindowIcon(opts: WindowIconOptions): ReactNode {
  const { type, size = 14, metadata, appIcon, appColor } = opts;

  // 0. Custom poster/cover image (e.g. movie or TV show)
  const iconUrl = resolveWindowIconUrl(type, metadata);
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-sm object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  // 1. Built-in window types with hardcoded icons
  const staticImage = WINDOW_TYPE_ICON_IMAGE[type];
  if (staticImage) {
    return <StaticIcon src={staticImage} size={size} />;
  }

  // 2. Page windows (DB-backed)
  if (type === "page") {
    return <AppIcon icon={appIcon} color={appColor} size={size} />;
  }

  // 3. System & app windows — fallback to generic icon in standalone mode
  if (type === "system" || type === "page") {
    return (
      <AppIcon
        iconComponent={LayoutDashboard}
        color="#6366f1"
        size={size}
      />
    );
  }

  // 5. File-based windows → material icon (only when a real filename exists)
  const fileName = metadata?.fileName;
  if (fileName) return <MaterialFileIcon name={fileName} size={size} />;
  return null;
}
