import type { LucideIcon } from "lucide-react";
import { ICON_COMPONENT_MAP } from "../../lib/icon-catalog";

/** Check whether an icon value is a lucide icon reference (e.g. "lucide:film") */
export function isLucideIcon(icon: string | undefined | null): boolean {
  return !!icon?.startsWith("lucide:");
}

/** Extract the kebab-case icon name from "lucide:film" format */
export function parseLucideIcon(icon: string): string {
  return icon.slice(7);
}

/** Resolve a "lucide:xxx" icon string to a LucideIcon component, or null */
export function resolveLucideIcon(
  icon: string | undefined | null,
): LucideIcon | null {
  if (!isLucideIcon(icon)) return null;
  return ICON_COMPONENT_MAP.get(parseLucideIcon(icon!)) ?? null;
}
