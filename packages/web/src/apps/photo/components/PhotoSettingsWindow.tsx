/**
 * PhotoSettingsWindow — modal window wrapper for PhotoSettingsPage.
 * Opened via `openModalWindow()` from PhotoApp.
 */

import { Spin } from "@tokimo/ui";
import { lazy, Suspense } from "react";
import type { WindowState as _WindowState } from "@/system/window/window-types";

const PhotoSettingsPage = lazy(
  () => import("@/apps/settings/admin/PhotoSettingsPage"),
);

export default function PhotoSettingsWindow(_: { win: _WindowState }) {
  return (
    <div className="h-full overflow-auto">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spin />
          </div>
        }
      >
        <PhotoSettingsPage />
      </Suspense>
    </div>
  );
}
