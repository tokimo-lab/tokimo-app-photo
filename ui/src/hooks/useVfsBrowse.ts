import type { ShellApi } from "@tokimo/sdk";
import type { PathSelectorBrowseArgs } from "@tokimo/ui";
import { useCallback } from "react";
import {
  type BrowseBridge,
  registerBrowseBridge,
} from "../shared/browse-bridge";

export function useVfsBrowse(shell: ShellApi) {
  return useCallback(
    (args: PathSelectorBrowseArgs) =>
      new Promise<string | null>((resolve) => {
        const bridge: BrowseBridge = {
          kind: "vfs-browse",
          shell,
          initialPath: args.initialPath,
          sourceId: args.sourceId,
          protocolPrefix: args.protocolPrefix,
          resolve,
        };
        const bridgeId = registerBrowseBridge(bridge);
        shell.openModalWindow({
          component: () => import("../components/VfsBrowserWindow"),
          title: "选择目录",
          width: 600,
          height: 480,
          metadata: { bridgeId },
        });
      }),
    [shell],
  );
}
