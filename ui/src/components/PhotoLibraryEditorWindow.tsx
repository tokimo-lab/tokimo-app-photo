import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ShellWindowHandle } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import { useState } from "react";
import { getPhotoI18n } from "../i18n";
import { getBridge } from "../modal-bridge";
import PhotoLibraryEditor from "./PhotoLibraryEditor";

export default function PhotoLibraryEditorWindow({
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

  const { uiLocale } = getPhotoI18n(bridge.locale);

  const handleSaved = () => {
    bridge.onMutated();
    win.close();
  };

  const handleDeleted = () => {
    bridge.onMutated();
    win.close();
  };

  const handleCancel = () => {
    win.close();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={uiLocale}>
        <ToastProvider>
          <PhotoLibraryEditor
            photoId={bridge.photoId}
            shell={bridge.shell}
            locale={bridge.locale}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={handleCancel}
          />
        </ToastProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
