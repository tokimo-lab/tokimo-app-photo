export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PhotoLibrarySourceOutput {
  sourceId: string;
  rootPath: string;
  sortOrder: number;
  isDefaultDownload: boolean;
  sourceName?: string | null;
  sourceType?: string | null;
}

export interface PhotoLibraryOutput {
  id: string;
  name: string;
  type: string;
  avatar?: JsonValue | null;
  description?: string | null;
  posterPath?: string | null;
  scrapeEnabled: boolean;
  sortOrder: number;
  settings?: JsonValue | null;
  syncStatus: string;
  lastSyncAt?: string | null;
  itemCount: number;
  sources: PhotoLibrarySourceOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface PhotoOutput {
  id: string;
  appId: string;
  filename: string;
  path: string;
  title?: string | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  mimeType?: string | null;
  takenAt?: string | null;
  thumbnailPath?: string | null;
  isFavorite: boolean;
  cameraMake?: string | null;
  cameraModel?: string | null;
  orientation?: number | null;
  liveVideoPath?: string | null;
  sourceId?: string | null;
}

export interface PhotoDetailOutput extends PhotoOutput {
  description?: string | null;
  lensModel?: string | null;
  focalLength?: number | null;
  aperture?: number | null;
  shutterSpeed?: string | null;
  iso?: number | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  gpsAltitude?: number | null;
  locationName?: string | null;
  geoProvince?: string | null;
  geoCity?: string | null;
  geoDistrict?: string | null;
  geoTownship?: string | null;
  geoAdcode?: string | null;
  geoAddress?: string | null;
  isHidden: boolean;
  scannedAt?: string | null;
  ocrScannedAt?: string | null;
  ocrDebugInfo?: Record<string, unknown> | null;
  createdAt?: string | null;
  exifData?: Record<
    string,
    string | number | boolean | null | undefined
  > | null;
}

export interface PhotoAlbumOutput {
  id: string;
  appId: string;
  name: string;
  description?: string | null;
  coverPhotoId?: string | null;
  albumType: string;
  photoCount: number;
}

export interface PersonOutput {
  id: string;
  name?: string | null;
  faceCount: number;
  avatarPhotoId?: string | null;
  avatarThumbnailPath?: string | null;
}

export interface PhotoFaceOutput {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number | null;
  personId?: string | null;
  personName?: string | null;
}

export interface PhotoTag {
  category: string;
  subcategory: string;
  confidence?: number;
  score: number;
  icon?: string | null;
}

export interface PhotoTagsResponse {
  photoId: string;
  indexed: boolean;
  tags: PhotoTag[];
}

export interface WsJobRecord {
  id: string;
  type: string;
  status: string;
  progress?: number | null;
  appId?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WsJobEvent {
  type: "job_update" | "external_job_update";
  job: WsJobRecord;
  appId?: string | null;
}

export type RepeatMode = "off" | "one" | "all";
export interface CreditOutput {
  id: string;
  name: string;
  role?: string | null;
}
