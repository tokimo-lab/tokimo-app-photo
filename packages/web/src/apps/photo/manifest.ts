import { Camera } from "lucide-react";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "photo",
  category: "system",
  fullBleed: true,
  defaultSize: { width: 1200, height: 800 },
  icon: Camera,
  image: "/page-icons/photo.png",
  color: "#8b5cf6",
  appName: "dashboard.menu.photo",
  order: 3,
  component: () => import("./components/PhotoApp"),
  menuBar: () => import("./components/PhotoMenuBar"),

  userSettings: {
    order: 13,
    sections: [
      {
        key: "sidebar",
        label: "settings.sidebar.title",
        fields: [
          {
            key: "sidebarCollapsed",
            type: "boolean",
            label: "settings.sidebar.defaultCollapsed",
            defaultValue: false,
          },
        ],
      },
    ],
  },

  notifications: {
    categories: [
      { id: "sync_completed", label: "photo.notifications.syncCompleted" },
      { id: "sync_failed", label: "photo.notifications.syncFailed" },
      {
        id: "processing_progress",
        label: "photo.notifications.processingProgress",
      },
      {
        id: "processing_completed",
        label: "photo.notifications.processingCompleted",
      },
      {
        id: "processing_failed",
        label: "photo.notifications.processingFailed",
      },
    ],
  },
};
