/**
 * Rust API Runtime — typed React Query hooks for calling the standalone Mail
 * app's UDS-backed HTTP API (transparently reverse-proxied by the shell server
 * at `/api/apps/mail/*`).
 *
 * Standalone-app variant: NO dependency on `react-i18next`, `@/lib/error-display`,
 * or `@/system`. Errors surface as React Query's standard `error` field; the
 * caller wires up `useShellToast(ctx)` if it wants UX feedback.
 */

import {
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
  type UseMutationOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { authFetch } from "./auth-fetch";
import { DEV_SERVER } from "./server-base";

// ── Base URL ─────────────────────────────────────────────────────────────────

export function rustUrl(path: string): string {
  return DEV_SERVER ? `${DEV_SERVER}${path}` : path;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

interface ApiOk<T> {
  success: true;
  data: T;
}
interface ApiErr {
  success: false;
  error: string;
}
type ApiResult<T> = ApiOk<T> | ApiErr;

class RustApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "RustApiError";
  }
}

function langHeader(): string {
  try {
    const htmlLang = document.documentElement.lang;
    if (htmlLang) return htmlLang;
  } catch {
    /* ignore */
  }
  try {
    return navigator.language || "zh-CN";
  } catch {
    return "zh-CN";
  }
}

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-lang": langHeader(),
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch {
    throw new RustApiError("Network error", 0);
  }
  let json: ApiResult<T>;
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    throw new RustApiError("Invalid JSON response", res.status);
  }
  if (!json.success) {
    throw new RustApiError(
      (json as ApiErr).error ?? "Unknown error",
      res.status,
    );
  }
  return (json as ApiOk<T>).data;
}

// ── Query factory ────────────────────────────────────────────────────────────

interface RouteConfig {
  method?: string;
  path: string;
}

interface QueryRouteConfig<TInput> extends RouteConfig {
  pathFn?: (input: TInput) => string;
  paramsFn?: (input: TInput) => Record<string, string>;
}

interface MutationRouteConfig<TInput> extends RouteConfig {
  pathFn?: (input: TInput) => string;
  bodyFn?: (input: TInput) => unknown;
}

export function createQuery<TInput, TOutput>(cfg: QueryRouteConfig<TInput>) {
  const method = cfg.method ?? "GET";

  function queryKey(input?: TInput): QueryKey {
    return input != null ? [cfg.path, input] : [cfg.path];
  }

  function queryFn(input?: TInput): () => Promise<TOutput> {
    return () => {
      const actualPath =
        cfg.pathFn && input != null ? cfg.pathFn(input) : cfg.path;

      if (method === "GET") {
        let qs = "";
        if (cfg.paramsFn && input != null) {
          qs = `?${new URLSearchParams(cfg.paramsFn(input)).toString()}`;
        } else if (!cfg.pathFn && input != null) {
          qs = `?${new URLSearchParams(input as Record<string, string>).toString()}`;
        }
        return callApi<TOutput>(rustUrl(`${actualPath}${qs}`));
      }
      return callApi<TOutput>(rustUrl(actualPath), {
        method,
        body: input != null ? JSON.stringify(input) : undefined,
      });
    };
  }

  return {
    queryKey,
    useQuery: (
      ...args: TInput extends void
        ? [opts?: Partial<UseQueryOptions<TOutput>>]
        : [input: TInput, opts?: Partial<UseQueryOptions<TOutput>>]
    ) => {
      const [inputOrOpts, maybeOpts] = args as [unknown, unknown];
      const firstIsOptsObject =
        typeof inputOrOpts === "object" &&
        inputOrOpts !== null &&
        "queryKey" in inputOrOpts;
      const isVoidInput = inputOrOpts === undefined || firstIsOptsObject;
      const input = isVoidInput ? undefined : (inputOrOpts as TInput);
      const opts = (firstIsOptsObject ? inputOrOpts : maybeOpts) as
        | Partial<UseQueryOptions<TOutput>>
        | undefined;

      return useQuery<TOutput>({
        queryKey: queryKey(input),
        queryFn: queryFn(input),
        ...opts,
      });
    },
    fetch: (input?: TInput) => queryFn(input)(),
    invalidate: (qc: ReturnType<typeof useQueryClient>, input?: TInput) =>
      qc.invalidateQueries({ queryKey: queryKey(input) }),
    getData: (qc: ReturnType<typeof useQueryClient>, input?: TInput) =>
      qc.getQueryData<TOutput>(queryKey(input)),
    setData: (
      qc: ReturnType<typeof useQueryClient>,
      input: TInput | undefined,
      updater: TOutput | ((prev: TOutput | undefined) => TOutput | undefined),
    ) => qc.setQueryData(queryKey(input), updater),
  };
}

// ── Infinite Query factory ───────────────────────────────────────────────────

interface InfiniteQueryRouteConfig<TInput> extends RouteConfig {
  pathFn?: (input: TInput) => string;
  paramsFn?: (input: TInput) => Record<string, string>;
}

export function createInfiniteQuery<
  TInput,
  TPage extends { page: number; totalPages: number },
>(cfg: InfiniteQueryRouteConfig<TInput>) {
  function queryKey(input?: TInput): QueryKey {
    return input != null ? [cfg.path, input] : [cfg.path];
  }

  return {
    queryKey,
    useInfiniteQuery: (
      input: TInput,
      opts?: Partial<
        UseInfiniteQueryOptions<
          TPage,
          Error,
          InfiniteData<TPage>,
          QueryKey,
          number
        >
      >,
    ) =>
      useInfiniteQuery<TPage, Error, InfiniteData<TPage>, QueryKey, number>({
        queryKey: queryKey(input),
        queryFn: ({ pageParam }) => {
          const actualPath = cfg.pathFn ? cfg.pathFn(input) : cfg.path;
          const params: Record<string, string> = cfg.paramsFn
            ? cfg.paramsFn(input)
            : {};
          params.page = String(pageParam);
          const qs = new URLSearchParams(params).toString();
          return callApi<TPage>(
            rustUrl(qs ? `${actualPath}?${qs}` : actualPath),
          );
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) =>
          lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
        ...opts,
      }),
    invalidate: (qc: ReturnType<typeof useQueryClient>, input?: TInput) =>
      qc.invalidateQueries({ queryKey: queryKey(input) }),
    setData: (
      qc: ReturnType<typeof useQueryClient>,
      input: TInput | undefined,
      updater:
        | InfiniteData<TPage>
        | ((
            prev: InfiniteData<TPage> | undefined,
          ) => InfiniteData<TPage> | undefined),
    ) => qc.setQueryData(queryKey(input), updater),
  };
}

// ── Mutation factory ─────────────────────────────────────────────────────────

export function createMutation<TInput, TOutput>(
  cfg: MutationRouteConfig<TInput>,
) {
  const method = cfg.method ?? "POST";

  function mutationFn(input: TInput): Promise<TOutput> {
    const actualPath = cfg.pathFn ? cfg.pathFn(input) : cfg.path;
    const body = cfg.bodyFn ? cfg.bodyFn(input) : input;
    return callApi<TOutput>(rustUrl(actualPath), {
      method,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  return {
    useMutation: (
      opts?: Partial<UseMutationOptions<TOutput, RustApiError, TInput>>,
    ) =>
      useMutation<TOutput, RustApiError, TInput>({
        mutationFn,
        ...opts,
      }),
    mutate: mutationFn,
  };
}

export function createPathMutation<TInput, TOutput>(cfg: {
  method?: string;
  pathFn: (input: TInput) => string;
  bodyFn?: (input: TInput) => unknown;
}) {
  const method = cfg.method ?? "POST";

  function mutationFn(input: TInput): Promise<TOutput> {
    const body = cfg.bodyFn ? cfg.bodyFn(input) : undefined;
    return callApi<TOutput>(rustUrl(cfg.pathFn(input)), {
      method,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  }

  return {
    useMutation: (
      opts?: Partial<UseMutationOptions<TOutput, RustApiError, TInput>>,
    ) =>
      useMutation<TOutput, RustApiError, TInput>({
        mutationFn,
        ...opts,
      }),
    mutate: mutationFn,
  };
}

export { RustApiError };

// ── SSE Streaming ────────────────────────────────────────────────────────────

async function streamApi<TInput, TChunk>(
  path: string,
  input: TInput,
  onChunk: (chunk: TChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await authFetch(rustUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-lang": langHeader(),
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!res.ok) {
    throw new RustApiError("Streaming request failed", res.status);
  }
  if (!res.body) {
    throw new RustApiError("No response body", res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (!part.trim()) continue;
      for (const line of part.split("\n")) {
        if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            onChunk(JSON.parse(raw) as TChunk);
          } catch {
            // skip malformed SSE data lines
          }
        }
      }
    }
  }
}

export function createStreamMutation<TInput, TChunk>(cfg: { path: string }) {
  return {
    stream: (
      input: TInput,
      onChunk: (chunk: TChunk) => void,
      signal?: AbortSignal,
    ): Promise<void> =>
      streamApi<TInput, TChunk>(cfg.path, input, onChunk, signal),
  };
}
