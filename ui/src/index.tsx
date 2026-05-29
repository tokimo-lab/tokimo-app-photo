import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dispose } from "@tokimo/sdk";
import { defineApp } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppCtxProvider } from "./AppContext";
import PhotoApp from "./components/PhotoApp";
import PhotoMenuBar from "./components/PhotoMenuBar";
import { getPhotoI18n } from "./i18n";
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
      defaultOptions: { queries: { retry: 1 } },
    });
    const { uiLocale } = getPhotoI18n(ctx.locale);
    const root: Root = createRoot(container);

    root.render(
      <StrictMode>
        <AppCtxProvider value={ctx}>
          <QueryClientProvider client={queryClient}>
            <ConfigProvider locale={uiLocale}>
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
