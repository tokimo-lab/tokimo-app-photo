import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "photo",
  name: "Photo Library",
  category: "page",
  supportedTypes: ["photo"],
  defaultSize: { width: 1200, height: 800 },
  component: () => import("./pages/PhotoAppPage"),
};
