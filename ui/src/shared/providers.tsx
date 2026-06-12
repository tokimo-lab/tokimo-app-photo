import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppRuntimeCtx } from "@tokimo/sdk";
import { RuntimeProvider } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import type { ReactNode } from "react";
import { AppCtxProvider } from "../AppContext";
import { getPhotoI18n } from "../i18n";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

/**
 * Wraps a React node with the full provider tree required by photo app
 * components. Used by the extension system to render AI UI slots inside
 * the monolith's Photo Viewer, which does not own these providers.
 */
export function withProviders(node: ReactNode, ctx: AppRuntimeCtx): ReactNode {
  const { uiLocale } = getPhotoI18n(ctx.locale);
  return (
    <RuntimeProvider value={ctx}>
      <AppCtxProvider value={ctx}>
        <QueryClientProvider client={queryClient}>
          <ConfigProvider locale={uiLocale}>
            <ToastProvider>{node}</ToastProvider>
          </ConfigProvider>
        </QueryClientProvider>
      </AppCtxProvider>
    </RuntimeProvider>
  );
}
