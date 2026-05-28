import type { MenuBarConfig, OpenWindowParams, ShellJobEvent, ShellModalWindowParams } from "@tokimo/sdk";
import {
  useShellAppearance,
  useShellMenuBar,
  useShellToast,
  useShellWindowNav,
} from "@tokimo/sdk/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAppCtx } from "../AppContext";
import type { WsJobEvent } from "../lib/types";

export type { MenuBarConfig };
export const DEFAULT_LONG_FORMAT = "yyyy-MM-dd HH:mm:ss";

interface WindowRouteParams {
  appId?: string;
  photoId?: string;
}

interface WindowNavResult {
  route: string;
  canGoBack: boolean;
  navigate: (route: string, title?: string) => void;
  replace: (route: string, title?: string) => void;
  goBack: () => void;
  LazyViewComponent: React.ComponentType | null;
  params: WindowRouteParams;
  metadata: Record<string, unknown>;
  updateTitle: (title: string) => void;
  updateMetadata: (metadata: Record<string, unknown>) => void;
  openWindow: (params: OpenWindowParams) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRouteParams(route: string): WindowRouteParams {
  const parts = route.split("/").filter(Boolean);
  if (parts[0] === "library" && parts[1]) return { appId: parts[1] };
  if (parts[0] === "photo" && parts[1]) return { photoId: parts[1] };
  return {};
}

function toJobEvent(event: ShellJobEvent): WsJobEvent | null {
  const jobSource = isRecord(event.job)
    ? event.job
    : isRecord(event.data) && isRecord(event.data.job)
      ? event.data.job
      : isRecord(event.data)
        ? event.data
        : null;
  if (!jobSource) return null;
  const id = jobSource.id;
  const type = jobSource.type;
  const status = jobSource.status;
  if (typeof id !== "string" || typeof type !== "string" || typeof status !== "string") return null;
  return {
    type: event.type,
    appId: typeof event.appId === "string" ? event.appId : null,
    job: {
      id,
      type,
      status,
      progress: typeof jobSource.progress === "number" ? jobSource.progress : null,
      appId: typeof jobSource.appId === "string" ? jobSource.appId : null,
      error: typeof jobSource.error === "string" ? jobSource.error : null,
      metadata: isRecord(jobSource.metadata) ? jobSource.metadata : null,
    },
  };
}

export function useMessage() {
  const ctx = useAppCtx();
  return useShellToast(ctx);
}

export function useWindowNav(): WindowNavResult {
  const ctx = useAppCtx();
  const shellNav = useShellWindowNav(ctx);
  const params = useMemo(() => parseRouteParams(shellNav.route), [shellNav.route]);
  const metadata = useMemo<Record<string, unknown>>(
    () => ({ appId: params.appId, sourceId: params.photoId, ...params }),
    [params],
  );
  return {
    ...shellNav,
    LazyViewComponent: null,
    params,
    metadata,
    updateTitle: (_title: string) => undefined,
    updateMetadata: (_metadata: Record<string, unknown>) => undefined,
    openWindow: ctx.shell.windowManager.openWindow,
  };
}

export function useWindowNavHook() {
  return useWindowNav();
}

export function useMenuBar(config: MenuBarConfig | null) {
  const ctx = useAppCtx();
  useShellMenuBar(ctx, config);
}

export function useThemeCore() {
  const ctx = useAppCtx();
  const appearance = useShellAppearance(ctx);
  return {
    isMacStyle: appearance.isMacStyle,
    theme: appearance.theme,
    titleBarStyle: appearance.titleBarStyle,
  };
}

export function useWindowId(): string {
  return useAppCtx().windowId;
}

export function useOptionalWindowId(): string | undefined {
  return useAppCtx().windowId;
}

type ModalParams = ShellModalWindowParams & { parentWindowId?: string };

export function useWindowActions() {
  const ctx = useAppCtx();
  const openModalWindow = (params: ModalParams) => {
    const { parentWindowId: _parentWindowId, ...shellParams } = params;
    return ctx.shell.openModalWindow(shellParams);
  };
  const updateTitle = (idOrTitle: string, maybeTitle?: string) => {
    const title = maybeTitle ?? idOrTitle;
    ctx.shell.windowManager.updateMetadata(maybeTitle ? idOrTitle : ctx.windowId, { title });
  };
  const updateMetadata = (idOrMetadata: string | Record<string, unknown>, maybeMetadata?: Record<string, unknown>) => {
    if (typeof idOrMetadata === "string") {
      ctx.shell.windowManager.updateMetadata(idOrMetadata, maybeMetadata ?? {});
      return;
    }
    ctx.shell.windowManager.updateMetadata(ctx.windowId, idOrMetadata);
  };
  return {
    openWindow: ctx.shell.windowManager.openWindow,
    openModalWindow,
    closeWindow: ctx.shell.windowManager.closeWindow,
    updateTitle,
    updateMetadata,
  };
}

export function useDateFormat() {
  const formatLong = (value: string | number | Date) => new Date(value).toLocaleString();
  return { format: DEFAULT_LONG_FORMAT, longFormat: DEFAULT_LONG_FORMAT, formatLong };
}

export function useAppEntityEvents(options?: {
  appId?: string;
  kind?: string;
  scope?: string;
  onEvent?: (event: { appId?: string | null; kind?: string | null; scope?: string | null; entityId?: string | null }) => void;
  enabled?: boolean;
}) {
  const ctx = useAppCtx();
  const callbackRef = useRef(options?.onEvent);
  callbackRef.current = options?.onEvent;
  useEffect(() => {
    if (options?.enabled === false || !options?.appId || !callbackRef.current) return undefined;
    return ctx.shell.appEntityEvents.subscribe({
      enabled: true,
      onEvent: (event) => {
        if (event.appId !== options.appId) return;
        if (options.kind && event.kind !== options.kind) return;
        if (options.scope && event.scope !== options.scope) return;
        callbackRef.current?.({ appId: event.appId, kind: event.kind, scope: event.scope });
      },
    });
  }, [ctx.shell.appEntityEvents, options?.appId, options?.enabled, options?.kind, options?.scope]);
}

export function useJobEvents(options?: {
  jobTypes?: readonly string[];
  enabled?: boolean;
  onEvent?: (event: WsJobEvent) => void;
}) {
  const ctx = useAppCtx();
  const callbackRef = useRef(options?.onEvent);
  callbackRef.current = options?.onEvent;
  const jobTypes = options?.jobTypes;
  useEffect(() => {
    if (options?.enabled === false || !callbackRef.current) return undefined;
    return ctx.shell.jobEvents.subscribe({
      enabled: true,
      onEvent: (event) => {
        const normalized = toJobEvent(event);
        if (!normalized) return;
        if (jobTypes && jobTypes.length > 0 && !jobTypes.includes(normalized.job.type)) return;
        callbackRef.current?.(normalized);
      },
    });
  }, [ctx.shell.jobEvents, options?.enabled, jobTypes]);
}

export function useAppEvent(handler: (event: WsJobEvent) => void) {
  useJobEvents({ onEvent: handler });
}

export function useBackgroundArt() {
  return { setBackgroundArt: (_url: string | null) => undefined };
}

export class PickCancelled extends Error {
  constructor() {
    super("Pick cancelled");
    this.name = "PickCancelled";
  }
}

export async function pickWithBridge<T>(
  openFn: (params: ShellModalWindowParams) => string,
  options: ShellModalWindowParams,
): Promise<T> {
  openFn(options);
  throw new PickCancelled();
}
