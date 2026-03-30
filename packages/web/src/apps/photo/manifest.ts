import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "photo",
  name: "Photo Library",
  category: "page",
  supportedTypes: ["photo"],
  defaultSize: { width: 1200, height: 800 },
  component: () => import("./pages/PhotoAppPage"),

  settings: [
    {
      key: "display",
      label: "settings.photo.display",
      fields: [
        {
          key: "defaultView",
          type: "select",
          label: "settings.photo.defaultView",
          defaultValue: "grid",
          options: [
            { label: "settings.photo.viewGrid", value: "grid" },
            { label: "settings.photo.viewTimeline", value: "timeline" },
            { label: "settings.photo.viewMap", value: "map" },
          ],
        },
        {
          key: "thumbnailSize",
          type: "select",
          label: "settings.photo.thumbnailSize",
          defaultValue: "medium",
          options: [
            { label: "settings.photo.sizeSmall", value: "small" },
            { label: "settings.photo.sizeMedium", value: "medium" },
            { label: "settings.photo.sizeLarge", value: "large" },
          ],
        },
      ],
    },
  ],
};
