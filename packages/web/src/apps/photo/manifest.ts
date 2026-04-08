import { Camera } from "lucide-react";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "photo",
  name: "TokimoPhoto",
  category: "system",
  fullBleed: true,
  defaultSize: { width: 1200, height: 800 },
  icon: Camera,
  image: "/page-icons/photo.png",
  color: "#8b5cf6",
  labelKey: "photo",
  order: 3,
  component: () => import("./components/PhotoApp"),
  menuBar: () => import("./components/PhotoMenuBar"),
};
