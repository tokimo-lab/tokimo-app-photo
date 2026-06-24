import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type AppRuntimeCtx, RuntimeProvider } from "@tokimo/sdk";
import {
  ConfigProvider,
  ToastProvider,
  enUS as uiEnUS,
  zhCN as uiZhCN,
} from "@tokimo/ui";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

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
          <ToastProvider>{children}</ToastProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </RuntimeProvider>
  );
}
