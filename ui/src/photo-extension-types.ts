import type { ReactNode, RefObject } from "react";

export interface PhotoInfo {
  id: string;
  filename: string;
  title?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  mimeType?: string | null;
  takenAt?: string | null;
  isFavorite?: boolean;
  orientation?: number | null;
  liveVideoPath?: string | null;
  sourceId?: string | null;
  appId?: string | null;
  path?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAltitude?: number | null;
  locationName?: string | null;
  geoAddress?: string | null;
  geoProvince?: string | null;
  geoCity?: string | null;
  geoDistrict?: string | null;
  geoTownship?: string | null;
  ocrScannedAt?: string | null;
  description?: string | null;
}

export interface PhotoDisplayContext {
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
  imgRef: RefObject<HTMLImageElement | null>;
}

export interface PhotoExtension {
  renderImageOverlays?: (
    photo: PhotoInfo,
    ctx: PhotoDisplayContext,
  ) => ReactNode;
  renderInfoPanelExtras?: (photo: PhotoInfo) => ReactNode;
  renderToolbarSlot?: (photo: PhotoInfo) => ReactNode;
}
