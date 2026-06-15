import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type AppRuntimeCtx, RuntimeProvider } from "@tokimo/sdk";
import type { ReactNode } from "react";

export function withProviders(
  ctx: AppRuntimeCtx,
  queryClient: QueryClient,
  node: ReactNode,
): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider value={ctx}>{node}</RuntimeProvider>
    </QueryClientProvider>
  );
}
