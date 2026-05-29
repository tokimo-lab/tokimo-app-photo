import type { ShellApi } from "@tokimo/sdk";
import type { PathSelectorBrowseArgs } from "@tokimo/ui";
import { useCallback } from "react";
import { getPhotoI18n } from "../i18n";
import {
  type BrowseBridge,
  registerBrowseBridge,
} from "../shared/browse-bridge";

export function useVfsBrowse(shell: ShellApi, locale?: string) {
  return useCallback(
    (args: PathSelectorBrowseArgs) =>
      new Promise<string | null>((resolve) => {
        const { t } = getPhotoI18n(locale);
        const bridge: BrowseBridge = {
          kind: "vfs-browse",
          shell,
          initialPath: args.initialPath,
          sourceId: args.sourceId,
          protocolPrefix: args.protocolPrefix,
          locale,
          resolve,
        };
        const bridgeId = registerBrowseBridge(bridge);
        shell.openModalWindow({
          component: () => import("../components/VfsBrowserWindow"),
          title: t("selectDirectory"),
          width: 600,
          height: 480,
          metadata: { bridgeId },
        });
      }),
    [shell, locale],
  );
}
