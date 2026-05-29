/**
 * VfsBrowserWindow — sidecar wrapper around @tokimo/ui FileBrowserWindow.
 */

import type { ShellWindowHandle } from "@tokimo/sdk";
import {
  ConfigProvider,
  type FileBrowserVfsApi,
  FileBrowserWindow,
} from "@tokimo/ui";
import { useState } from "react";
import { api } from "../api/client";
import { getPhotoI18n } from "../i18n";
import { clearBrowseBridge, getBrowseBridge } from "../shared/browse-bridge";

function formatLong(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

const vfsApi: FileBrowserVfsApi = {
  browse: (path, sourceId) => api.vfs.browse(sourceId, path),
  stat: {
    stat: (paths, sourceId) => api.vfs.stat(paths, sourceId),
  },
};

export default function VfsBrowserWindow({ win }: { win: ShellWindowHandle }) {
  const bridgeId =
    typeof win.metadata.bridgeId === "string" ? win.metadata.bridgeId : "";
  const [bridge] = useState(() =>
    bridgeId ? getBrowseBridge(bridgeId) : undefined,
  );

  if (!bridge) return null;

  const locale = bridge.locale;
  const { t, uiLocale } = getPhotoI18n(locale);

  // Map @tokimo/ui keys to PhotoI18n keys
  const tMap = (key: string): string => {
    switch (key) {
      case "pathSelector.refresh":
        return t("pathRefresh");
      case "pathSelector.selectDirectory":
        return t("pathSelectDirectory");
      case "pathSelector.emptyDirectory":
        return t("pathEmptyDirectory");
      case "pathSelector.colName":
        return t("pathColName");
      case "pathSelector.colPermissions":
        return t("pathColPermissions");
      case "pathSelector.colSize":
        return t("pathColSize");
      case "pathSelector.colModified":
        return t("pathColModified");
      case "pathSelector.cannotAccess":
        return t("pathCannotAccess");
      case "common.cancel":
        return t("commonCancel");
      default:
        return key;
    }
  };

  const finish = (path: string | null) => {
    bridge.resolve(path);
    clearBrowseBridge(bridgeId);
    win.close();
  };

  return (
    <ConfigProvider locale={uiLocale}>
      <FileBrowserWindow
        initialPath={bridge.initialPath}
        sourceId={bridge.sourceId}
        protocolPrefix={bridge.protocolPrefix}
        vfsApi={vfsApi}
        t={tMap}
        formatLong={formatLong}
        onConfirm={(path) => finish(path)}
        onCancel={() => finish(null)}
      />
    </ConfigProvider>
  );
}
