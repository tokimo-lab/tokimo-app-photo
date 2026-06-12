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
import { Camera } from "lucide-react";
import { StrictMode, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import "./index.css";

const PhotoApp = lazy(() => import("./components/PhotoApp"));

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
    const root: Root = createRoot(container);
    const locale = ctx.locale.startsWith("zh") ? uiZhCN : uiEnUS;
    root.render(
      <StrictMode>
        <ConfigProvider locale={locale}>
          <ToastProvider>
            <RuntimeProvider value={ctx}>
              <Suspense fallback={null}>
                <PhotoApp />
              </Suspense>
            </RuntimeProvider>
          </ToastProvider>
        </ConfigProvider>
      </StrictMode>,
    );
    return () => root.unmount();
  },
});
