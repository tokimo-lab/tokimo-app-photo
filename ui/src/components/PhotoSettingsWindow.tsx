import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellWindowHandle } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider, zhCN } from "@tokimo/ui";
import { useState } from "react";
import { getBridge } from "../modal-bridge";
import PhotoLibraryEditor from "./PhotoLibraryEditor";

export default function PhotoSettingsWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
  const bridgeId =
    typeof win.metadata.bridgeId === "string" ? win.metadata.bridgeId : "";
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));
  const [queryClient] = useState(() => new QueryClient());

  if (bridge?.kind !== "settings") {
    return null;
  }

  const handleSaved = () => {
    win.close();
    bridge.onMutated();
  };

  const handleDeleted = () => {
    win.close();
    bridge.onMutated();
  };

  const handleCancel = () => {
    win.close();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN}>
        <ToastProvider>
          <PhotoLibraryEditor
            photoId={bridge.photoId}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={handleCancel}
          />
        </ToastProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
