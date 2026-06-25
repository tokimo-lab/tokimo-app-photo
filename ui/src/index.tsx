/**
 * Photo app — standalone entry point.
 *
 * This file bootstraps the photo app as a self-contained Tokimo app.
 * The actual UI lives in ui/src/components/ and ui/src/pages/.
 */
import {
  type AppRuntimeCtx,
  type Dispose,
  defineApp,
  RuntimeProvider,
} from "@tokimo/sdk";
import {
  ConfigProvider,
  ToastProvider,
  enUS as uiEnUS,
  zhCN as uiZhCN,
} from "@tokimo/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { StrictMode, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./index.css";
import { createPhotoExtension } from "./photo-extension";
import type { PhotoExtension } from "./photo-extension-types";
import { ensureWasmLoaded } from "./wasm-init";

const PhotoApp = lazy(() => import("./components/PhotoApp"));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

let photoExtensionMountCount = 0;
let unregisterPhotoExtension: (() => void) | undefined;

export default defineApp({
  id: "photo",
  manifest: {
    id: "photo",
    appName: "Photo",
    icon: "Camera",
    image: "icon.png",
    color: "#8b5cf6",
    windowType: "photo",
    defaultSize: { width: 1200, height: 800 },
    category: "app",
  },
  translations: {},
  mount(container, ctx): Dispose {
    void ensureWasmLoaded().catch((err) => {
      console.error("[photo-app] failed to preload WASM:", err);
    });
    const photoShell = ctx.shell as typeof ctx.shell & {
      photo?: {
        registerExtension: (
          appId: string,
          extension: PhotoExtension,
        ) => () => void;
      };
    };
    photoExtensionMountCount += 1;
    if (!unregisterPhotoExtension) {
      unregisterPhotoExtension = photoShell.photo?.registerExtension(
        "photo",
        createPhotoExtension(ctx),
      );
    }
    const root: Root = createRoot(container);
    const locale = ctx.locale.startsWith("zh") ? uiZhCN : uiEnUS;
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider locale={locale}>
            <ToastProvider>
              <RuntimeProvider value={ctx}>
                <Suspense fallback={null}>
                  <PhotoApp />
                </Suspense>
              </RuntimeProvider>
            </ToastProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    return () => {
      photoExtensionMountCount = Math.max(0, photoExtensionMountCount - 1);
      if (photoExtensionMountCount === 0) {
        unregisterPhotoExtension?.();
        unregisterPhotoExtension = undefined;
      }
      root.unmount();
    };
  },
});
