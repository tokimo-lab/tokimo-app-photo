import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type AppRuntimeCtx, RuntimeProvider } from "@tokimo/sdk";
import {
  ConfigProvider,
  ToastProvider,
  enUS as uiEnUS,
  zhCN as uiZhCN,
} from "@tokimo/ui";
import type { ReactNode } from "react";
import { usePersonEntityEvents } from "../hooks/usePersonEntityEvents";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function PhotoExtensionEventBridge() {
  usePersonEntityEvents(true);
  return null;
}

export function PhotoExtensionProviders({
  ctx,
  children,
}: {
  ctx: AppRuntimeCtx;
  children: ReactNode;
}) {
  const locale = ctx.locale.startsWith("zh") ? uiZhCN : uiEnUS;
  return (
    <RuntimeProvider value={ctx}>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={locale}>
          <ToastProvider>
            <PhotoExtensionEventBridge />
            {children}
          </ToastProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </RuntimeProvider>
  );
}
