import { useCallback } from "react";
import { useComponentPreference } from "@tokimo/sdk";

/**
 * Manages sidebar collapsed state with DB-backed preference persistence.
 *
 * Combines auto-collapse (e.g. < 720px) with manual user override:
 * - Auto-collapse only when the container is narrow AND no manual lock.
 * - If the user manually collapses, it stays collapsed regardless of width.
 * - Clicking the expand button releases the manual lock.
 *
 * Storage: `{ sidebar: { sidebarCollapsed: boolean } }` at scope="component",
 * matching the "sidebar" section key declared in app manifests so that the
 * settings page toggle and the in-app toggle share the same storage path.
 */
export function useSidebarCollapsed(
  componentId: string,
  autoCollapsed: boolean,
) {
  const { data, patch } = useComponentPreference<{
    sidebar?: { sidebarCollapsed?: boolean };
  }>(componentId);
  const manuallyCollapsed = data.sidebar?.sidebarCollapsed === true;
  const collapsed = autoCollapsed || manuallyCollapsed;

  const onToggleCollapse = useCallback(() => {
    patch({ sidebar: { sidebarCollapsed: !collapsed } });
  }, [collapsed, patch]);

  return { collapsed, onToggleCollapse };
}
