/**
 * Local icon catalog stub for standalone photo app.
 *
 * The shell's full icon-catalog maps "kebab-case" names to LucideIcon
 * components. In standalone mode we only need the icons actually used
 * by the photo app; callers that resolve a missing name get `null`.
 */

import type { LucideIcon } from "lucide-react";

export const ICON_COMPONENT_MAP = new Map<string, LucideIcon>();
