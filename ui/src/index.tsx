import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dispose } from "@tokimo/sdk";
import { defineApp } from "@tokimo/sdk";
import {
  ConfigProvider,
  ToastProvider,
  enUS as uiEnUS,
  zhCN as uiZhCN,
} from "@tokimo/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppCtxProvider } from "./AppContext";
import PhotoApp from "./components/PhotoApp";
import PhotoMenuBar from "./components/PhotoMenuBar";
import "./index.css";

export default defineApp({
  id: "photo",
  manifest: {
    id: "photo",
    appName: "Photo",
    icon: "Image",
    image: "icon.png",
    color: "#10b981",
    windowType: "photo",
    defaultSize: { width: 1400, height: 900 },
    category: "system",
  },
  mount(container, ctx): Dispose {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
    });
    const locale = ctx.locale.startsWith("zh") ? uiZhCN : uiEnUS;
    const root: Root = createRoot(container);

    root.render(
      <StrictMode>
        <AppCtxProvider value={ctx}>
          <QueryClientProvider client={queryClient}>
            <ConfigProvider locale={locale}>
              <ToastProvider>
                <PhotoMenuBar>
                  <PhotoApp />
                </PhotoMenuBar>
              </ToastProvider>
            </ConfigProvider>
          </QueryClientProvider>
        </AppCtxProvider>
      </StrictMode>,
    );
    return () => root.unmount();
  },
});
