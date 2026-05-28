import { useCallback, useEffect, useState } from "react";

export function useSidebarCollapsed(componentId: string, autoCollapsed: boolean) {
  const key = `${componentId}:sidebarCollapsed`;
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setManual(localStorage.getItem(key) === "true");
  }, [key]);
  const collapsed = autoCollapsed || manual;
  const onToggleCollapse = useCallback(() => {
    setManual((current) => {
      const next = !collapsed || (!current && autoCollapsed);
      localStorage.setItem(key, String(next));
      return next;
    });
  }, [autoCollapsed, collapsed, key]);
  return { collapsed, onToggleCollapse };
}
