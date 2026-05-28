import {
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  PersonOutput,
  PhotoAlbumOutput,
  PhotoDetailOutput,
  PhotoFaceOutput,
  PhotoLibraryOutput,
  PhotoOutput,
  PhotoTagsResponse,
} from "../lib/types";

export function rustUrl(path: string): string {
  return path;
}

interface ApiOk<T> {
  success: true;
  data: T;
}
interface ApiErr {
  success: false;
  error: string;
}
type ApiResult<T> = ApiOk<T> | ApiErr;

export class PhotoApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PhotoApiError";
  }
}

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (error) {
    throw new PhotoApiError(
      error instanceof Error ? error.message : "Network error",
      0,
    );
  }

  if (res.status === 204) return undefined as T;

  let json: ApiResult<T>;
  try {
    json = (await res.json()) as ApiResult<T>;
  } catch {
    throw new PhotoApiError("Invalid JSON response", res.status);
  }
  if (!json.success) {
    throw new PhotoApiError(json.error || "API request failed", res.status);
  }
  return json.data;
}

export async function apiFetchBlob(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok)
    throw new PhotoApiError(`${res.status} ${res.statusText}`, res.status);
  return res;
}

export interface VfsDto {
  id: string;
  name: string;
  type: string;
  displayHints?: { protocolPrefix?: string; rootPath?: string };
  config?: unknown;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BrowseDirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  entries: BrowseEntry[];
}

export interface SourceStatEntry {
  path: string;
  size: number | null;
  modifiedAt: string | null;
  mode: string | null;
}

async function vfsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return callApi<T>(rustUrl(`/api/vfs${path}`), init);
}

interface RouteConfig {
  method?: string;
  path?: string;
}
interface QueryRouteConfig<TInput> extends RouteConfig {
  pathFn?: (input: TInput) => string;
  paramsFn?: (input: TInput) => Record<string, string>;
}
interface MutationRouteConfig<TInput> extends RouteConfig {
  pathFn?: (input: TInput) => string;
  bodyFn?: (input: TInput) => unknown;
}

export function createQuery<TInput, TOutput>(cfg: QueryRouteConfig<TInput>) {
  const method = cfg.method ?? "GET";
  function queryKey(input?: TInput): QueryKey {
    const base = cfg.path ?? cfg.pathFn?.(input as TInput) ?? "mutation";
    return input != null ? [base, input] : [base];
  }
  function queryFn(input?: TInput): () => Promise<TOutput> {
    return () => {
      const actualPath =
        cfg.pathFn && input != null ? cfg.pathFn(input) : (cfg.path ?? "");
      if (method === "GET") {
        const params =
          cfg.paramsFn && input != null ? cfg.paramsFn(input) : undefined;
        const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
        return callApi<TOutput>(rustUrl(`${actualPath}${qs}`));
      }
      return callApi<TOutput>(rustUrl(actualPath ?? ""), {
        method,
        body: input != null ? JSON.stringify(input) : undefined,
      });
    };
  }
  return {
    queryKey,
    useQuery: (
      ...args: TInput extends void
        ? [opts?: Partial<UseQueryOptions<TOutput, Error, TOutput, QueryKey>>]
        : [
            input: TInput,
            opts?: Partial<UseQueryOptions<TOutput, Error, TOutput, QueryKey>>,
          ]
    ) => {
      const [inputOrOpts, maybeOpts] = args as [unknown, unknown];
      const firstLooksLikeOpts =
        typeof inputOrOpts === "object" &&
        inputOrOpts !== null &&
        ("enabled" in inputOrOpts ||
          "queryKey" in inputOrOpts ||
          "staleTime" in inputOrOpts);
      const input =
        inputOrOpts === undefined || firstLooksLikeOpts
          ? undefined
          : (inputOrOpts as TInput);
      const opts = (firstLooksLikeOpts ? inputOrOpts : maybeOpts) as
        | Partial<UseQueryOptions<TOutput, Error, TOutput, QueryKey>>
        | undefined;
      return useQuery<TOutput, Error, TOutput, QueryKey>({
        queryKey: queryKey(input),
        queryFn: queryFn(input),
        ...opts,
      });
    },
    fetch: (input?: TInput) => queryFn(input)(),
    invalidate: (qc: ReturnType<typeof useQueryClient>, input?: TInput) =>
      qc.invalidateQueries({ queryKey: queryKey(input) }),
    getData: (qc: ReturnType<typeof useQueryClient>, input?: TInput) =>
      qc.getQueryData<TOutput>(queryKey(input)),
    setData: (
      qc: ReturnType<typeof useQueryClient>,
      input: TInput | undefined,
      updater: TOutput | ((prev: TOutput | undefined) => TOutput | undefined),
    ) => qc.setQueryData(queryKey(input), updater),
  };
}

export function createMutation<TInput, TOutput>(
  cfg: MutationRouteConfig<TInput>,
) {
  const method = cfg.method ?? "POST";
  function mutationFn(input: TInput): Promise<TOutput> {
    const actualPath = cfg.pathFn ? cfg.pathFn(input) : cfg.path;
    const body = cfg.bodyFn ? cfg.bodyFn(input) : input;
    return callApi<TOutput>(rustUrl(actualPath ?? ""), {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }
  return {
    useMutation: (opts?: UseMutationOptions<TOutput, Error, TInput>) =>
      useMutation<TOutput, Error, TInput>({ mutationFn, ...opts }),
    mutateAsync: mutationFn,
  };
}

export function createPathMutation<TInput, TOutput>(
  cfg: MutationRouteConfig<TInput>,
) {
  return createMutation<TInput, TOutput>(cfg);
}

// ── Input types (hand-maintained) ───────────────────────────────────────────

interface CreatePhotoLibraryInput {
  name: string;
  type: string;
  avatar?: Record<string, unknown> | null;
  description?: string | null;
  scrapeEnabled?: boolean;
  scrapeAgents?: string[];
  settings?: Record<string, unknown> | null;
  sources?: {
    sourceId: string;
    rootPath: string;
    sortOrder: number;
    isDefaultDownload?: boolean;
  }[];
}

interface UpdatePhotoLibraryInput {
  id: string;
  name?: string;
  avatar?: Record<string, unknown> | null;
  description?: string | null;
  scrapeEnabled?: boolean;
  scrapeAgents?: string[];
  settings?: Record<string, unknown> | null;
  sources?: {
    sourceId: string;
    rootPath: string;
    sortOrder: number;
    isDefaultDownload?: boolean;
  }[];
}

interface ListPhotosInput {
  id: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
  search?: string;
  favoritesOnly?: boolean;
  beforeDate?: string;
  afterDate?: string;
}

interface PhotoGeoSettings {
  provider: string;
  enabled: boolean;
  amapApiKey: string | null;
  amapSecret: string | null;
  amapJsApiKey: string | null;
  qqmapApiKey: string | null;
  qqmapSecretKey: string | null;
  tiandituServerKey: string | null;
  tiandituBrowserKey: string | null;
  mapboxAccessToken: string | null;
  maptilerApiKey: string | null;
  fallbackProvider: string | null;
}

interface SyncProgressOutput {
  isActive: boolean;
  pct: number;
  status?: string;
}

interface PhotoAiSettings {
  ocrEnabled: boolean;
  clipEnabled: boolean;
  faceEnabled: boolean;
  ocrModelName?: string;
  ocrDetMaxSide?: number | null;
}

interface OcrSearchResult {
  photoId: string;
  filename: string;
  thumbnailPath: string | null;
  matchedText: string;
}

export type PositioningType = "attention" | "ctc" | "canvas";

export interface PhotoOcrResultItem {
  id: string;
  text: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  angle?: number;
  score: number | null;
  paragraphId: number;
  charPositions?: { x: number; w: number }[] | null;
  modelName?: string | null;
  positioningType: PositioningType;
  corners?: [number, number][] | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function photoParamsFn(input: ListPhotosInput): Record<string, string> {
  const p: Record<string, string> = {};
  if (input.page != null) p.page = String(input.page);
  if (input.pageSize != null) p.pageSize = String(input.pageSize);
  if (input.sortBy) p.sortBy = input.sortBy;
  if (input.sortDir) p.sortDir = input.sortDir;
  if (input.search) p.search = input.search;
  if (input.favoritesOnly) p.favoritesOnly = "true";
  if (input.beforeDate) p.beforeDate = input.beforeDate;
  if (input.afterDate) p.afterDate = input.afterDate;
  return p;
}

// ── Photo API ────────────────────────────────────────────────────────────────

const enc = encodeURIComponent;

export const photoApi = {
  // ── Library CRUD ──
  list: createQuery<void, PhotoLibraryOutput[]>({
    path: "/api/apps/photo",
  }),
  getById: createQuery<{ id: string }, PhotoLibraryOutput | null>({
    path: "/api/apps/photo/{id}",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}`,
  }),
  create: createMutation<CreatePhotoLibraryInput, PhotoLibraryOutput>({
    path: "/api/apps/photo",
  }),
  update: createPathMutation<UpdatePhotoLibraryInput, PhotoLibraryOutput>({
    method: "PATCH",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}`,
    bodyFn: (input) => {
      const { id: _id, ...body } = input;
      return body;
    },
  }),
  delete: createPathMutation<string, { success: boolean }>({
    method: "DELETE",
    pathFn: (id) => `/api/apps/photo/${enc(id)}`,
  }),
  reorder: createMutation<
    { id: string; sortOrder: number }[],
    { success: boolean }
  >({
    path: "/api/apps/photo/reorder",
    bodyFn: (input) => ({ orders: input }),
  }),

  // ── Browse ──
  listPhotos: createQuery<
    ListPhotosInput,
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/{id}/photos",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos`,
    paramsFn: photoParamsFn,
  }),
  getPhotoTimeline: createQuery<
    { id: string; page?: number; pageSize?: number },
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/{id}/photos/timeline",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/timeline`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.page != null) p.page = String(input.page);
      if (input.pageSize != null) p.pageSize = String(input.pageSize);
      return p;
    },
  }),
  listPhotoFolders: createQuery<
    { id: string; path?: string },
    {
      folders: {
        name: string;
        path: string;
        photoCount: number;
        coverPhotoId: string | null;
      }[];
      photos: PhotoOutput[];
      path: string;
    }
  >({
    path: "/api/apps/photo/{id}/photos/folders",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/folders`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.path) p.path = input.path;
      return p;
    },
  }),
  getTimelineIndex: createQuery<
    { id: string },
    Array<{ year: number; month: number; day: number; count: number }>
  >({
    path: "/api/apps/photo/{id}/photos/timeline-index",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/timeline-index`,
  }),

  // ── Single photo (by photoId) ──
  getPhoto: createQuery<{ photoId: string }, PhotoDetailOutput | null>({
    path: "/api/apps/photo/item/{id}",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}`,
  }),
  updatePhoto: createPathMutation<
    { photoId: string; title?: string; description?: string; takenAt?: string },
    PhotoDetailOutput
  >({
    method: "PATCH",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}`,
    bodyFn: (input) => {
      const { photoId: _, ...body } = input;
      return body;
    },
  }),
  togglePhotoFavorite: createPathMutation<
    { photoId: string },
    { isFavorite: boolean }
  >({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/toggle-favorite`,
  }),
  togglePhotoHidden: createPathMutation<
    { photoId: string },
    { isHidden: boolean }
  >({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/toggle-hidden`,
  }),
  similarPhotos: createQuery<
    { photoId: string; limit?: number },
    {
      indexed: boolean;
      items: Array<{
        photoId: string;
        filename: string;
        thumbnailPath: string | null;
        similarity: number;
        width: number | null;
        height: number | null;
        takenAt: string | null;
        isFavorite: boolean;
        appId: string;
        path: string;
        title: string | null;
        fileSize: number | null;
        mimeType: string | null;
      }>;
    }
  >({
    path: "/api/apps/photo/item/{id}/similar",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/similar`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.limit != null) p.limit = String(input.limit);
      return p;
    },
  }),
  photoTags: createQuery<{ photoId: string }, PhotoTagsResponse>({
    path: "/api/apps/photo/item/{id}/tags",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/tags`,
  }),

  // ── Albums ──
  listPhotoAlbums: createQuery<{ id: string }, PhotoAlbumOutput[]>({
    path: "/api/apps/photo/{id}/photo-albums",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photo-albums`,
  }),
  createPhotoAlbum: createMutation<
    { id: string; name: string; description?: string },
    PhotoAlbumOutput
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photo-albums",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photo-albums`,
    bodyFn: (input) => ({ name: input.name, description: input.description }),
  }),
  deletePhotoAlbum: createPathMutation<
    { albumId: string },
    { success: boolean }
  >({
    method: "DELETE",
    pathFn: (input) => `/api/apps/photo/albums/${enc(input.albumId)}`,
  }),
  addPhotosToAlbum: createMutation<
    { albumId: string; photoIds: string[] },
    { photoCount: number }
  >({
    method: "POST",
    path: "/api/apps/photo/albums/{id}/add-photos",
    pathFn: (input) =>
      `/api/apps/photo/albums/${enc(input.albumId)}/add-photos`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  removePhotosFromAlbum: createMutation<
    { albumId: string; photoIds: string[] },
    { photoCount: number }
  >({
    method: "POST",
    path: "/api/apps/photo/albums/{id}/remove-photos",
    pathFn: (input) =>
      `/api/apps/photo/albums/${enc(input.albumId)}/remove-photos`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  listAlbumPhotos: createQuery<
    { albumId: string; page?: number; pageSize?: number },
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/albums/{id}/photos",
    pathFn: (input) => `/api/apps/photo/albums/${enc(input.albumId)}/photos`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.page) p.page = String(input.page);
      if (input.pageSize) p.pageSize = String(input.pageSize);
      return p;
    },
  }),

  // ── Batch operations ──
  batchFavorite: createMutation<
    { id: string; photoIds: string[]; favorite: boolean },
    { updated: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/batch-favorite",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/batch-favorite`,
    bodyFn: (input) => ({
      photoIds: input.photoIds,
      favorite: input.favorite,
    }),
  }),
  batchDelete: createMutation<
    { id: string; photoIds: string[] },
    { deleted: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/batch-delete",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/batch-delete`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  batchHide: createMutation<
    { id: string; photoIds: string[]; hidden: boolean },
    { updated: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/batch-hide",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/batch-hide`,
    bodyFn: (input) => ({ photoIds: input.photoIds, hidden: input.hidden }),
  }),
  trashPhotos: createMutation<
    { id: string; photoIds: string[] },
    { trashed: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/trash",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/trash`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  listTrashedPhotos: createQuery<
    { id: string; page?: number; pageSize?: number },
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/{id}/photos/trash",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/trash`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.page != null) p.page = String(input.page);
      if (input.pageSize != null) p.pageSize = String(input.pageSize);
      return p;
    },
  }),
  restorePhotos: createMutation<
    { id: string; photoIds: string[] },
    { restored: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/restore",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/restore`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  permanentDelete: createMutation<
    { id: string; photoIds: string[] },
    { deleted: number }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/photos/permanent-delete",
    pathFn: (input) =>
      `/api/apps/photo/${enc(input.id)}/photos/permanent-delete`,
    bodyFn: (input) => ({ photoIds: input.photoIds }),
  }),
  rescan: createPathMutation<
    { id: string; clearData?: boolean },
    { queued: number; message: string }
  >({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/rescan`,
  }),
  sync: createPathMutation<
    { id: string; clearData?: boolean },
    { success: boolean }
  >({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/sync`,
    bodyFn: (input) => ({ clearData: input.clearData ?? false }),
  }),

  // ── Geo ──
  reverseGeocode: createPathMutation<
    { id: string },
    { processed: number; skipped: number; total: number }
  >({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/${enc(input.id)}/photos/reverse-geocode`,
  }),
  getMapPoints: createQuery<
    { id: string },
    Array<{
      id: string;
      lat: number | null;
      lng: number | null;
      city: string | null;
    }>
  >({
    path: "/api/apps/photo/{id}/photos/map-points",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/map-points`,
  }),
  getLocationStats: createQuery<
    { id: string },
    Array<{
      province: string | null;
      city: string | null;
      district: string | null;
      photoCount: number;
    }>
  >({
    path: "/api/apps/photo/{id}/photos/locations",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/locations`,
  }),
  getPhotosByLocation: createQuery<
    {
      id: string;
      province?: string;
      city?: string;
      district?: string;
      page?: number;
      pageSize?: number;
    },
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/{id}/photos/by-location",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/by-location`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.province != null) p.province = input.province;
      if (input.city != null) p.city = input.city;
      if (input.district != null) p.district = input.district;
      if (input.page != null) p.page = String(input.page);
      if (input.pageSize != null) p.pageSize = String(input.pageSize);
      return p;
    },
  }),
  getPhotosByBbox: createQuery<
    {
      id: string;
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
      page?: number;
      pageSize?: number;
    },
    { items: PhotoOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/photo/{id}/photos/by-bbox",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/by-bbox`,
    paramsFn: (input) => {
      const p: Record<string, string> = {
        minLat: String(input.minLat),
        maxLat: String(input.maxLat),
        minLng: String(input.minLng),
        maxLng: String(input.maxLng),
      };
      if (input.page != null) p.page = String(input.page);
      if (input.pageSize != null) p.pageSize = String(input.pageSize);
      return p;
    },
  }),

  // ── AI / OCR / CLIP / Face (library-scoped) ──
  ocrScan: createPathMutation<{ id: string }, { status: string }>({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/ocr-scan`,
  }),
  ocrSearch: createQuery<{ id: string; q: string }, OcrSearchResult[]>({
    path: "/api/apps/photo/{id}/photos/ocr-search",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/ocr-search`,
    paramsFn: (input) => ({ q: input.q }),
  }),
  clipEmbed: createPathMutation<{ id: string }, { status: string }>({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/clip-embed`,
  }),
  clipSearch: createQuery<
    { id: string; q: string },
    Array<{
      photoId: string;
      filename: string;
      thumbnailPath: string | null;
      similarity: number;
      width: number | null;
      height: number | null;
      takenAt: string | null;
      isFavorite: boolean;
      appId: string;
      path: string;
      title: string | null;
      fileSize: number | null;
      mimeType: string | null;
    }>
  >({
    path: "/api/apps/photo/{id}/photos/clip-search",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/clip-search`,
    paramsFn: (input) => ({ q: input.q }),
  }),
  faceDetect: createPathMutation<{ id: string }, { status: string }>({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/face-detect`,
  }),
  clearAppOcrResults: createPathMutation<
    { id: string },
    { deletedCount: number }
  >({
    method: "DELETE",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/ocr-results`,
  }),
  clearFaceResults: createPathMutation<
    { id: string },
    { deletedCount: number }
  >({
    method: "DELETE",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/face-results`,
  }),
  clearClipResults: createPathMutation<
    { id: string },
    { deletedCount: number }
  >({
    method: "DELETE",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/clip-results`,
  }),
  clearThumbnails: createPathMutation<{ id: string }, { deletedCount: number }>(
    {
      method: "DELETE",
      pathFn: (input) => `/api/apps/photo/${enc(input.id)}/photos/thumbnails`,
    },
  ),

  // ── Persons (library-scoped) ──
  listPersons: createQuery<{ id: string }, PersonOutput[]>({
    path: "/api/apps/photo/{id}/persons",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/persons`,
  }),
  personPhotos: createQuery<
    { id: string; personId: string; page?: number; pageSize?: number },
    {
      items: PhotoOutput[];
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    }
  >({
    path: "/api/apps/photo/{id}/persons/{personId}/photos",
    pathFn: (input) =>
      `/api/apps/photo/${enc(input.id)}/persons/${enc(input.personId)}/photos`,
    paramsFn: (input) => {
      const p: Record<string, string> = {};
      if (input.page != null) p.page = String(input.page);
      if (input.pageSize != null) p.pageSize = String(input.pageSize);
      return p;
    },
  }),
  mergePersons: createMutation<
    { id: string; targetId: string; sourceId: string },
    { success: boolean }
  >({
    method: "POST",
    path: "/api/apps/photo/{id}/persons/merge",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/persons/merge`,
    bodyFn: (input) => ({
      targetId: input.targetId,
      sourceId: input.sourceId,
    }),
  }),
  renamePerson: createPathMutation<
    { id: string; personId: string; name: string },
    { success: boolean }
  >({
    method: "PATCH",
    pathFn: (input) =>
      `/api/apps/photo/${enc(input.id)}/persons/${enc(input.personId)}`,
  }),

  // ── Single-photo AI features ──
  getPhotoFaces: createQuery<{ photoId: string }, PhotoFaceOutput[]>({
    path: "/api/apps/photo/item/{id}/faces",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/faces`,
  }),
  assignFaceToPerson: createMutation<
    { photoId: string; faceId: number; personId: string },
    { success: boolean }
  >({
    method: "PATCH",
    path: "/api/apps/photo/item/{id}/faces/{faceId}/assign",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/faces/${enc(String(input.faceId))}/assign`,
    bodyFn: (input) => ({ personId: input.personId }),
  }),
  createPersonFromFace: createMutation<
    { photoId: string; faceId: number; name?: string },
    PersonOutput
  >({
    path: "/api/apps/photo/item/{id}/faces/{faceId}/create-person",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/faces/${enc(String(input.faceId))}/create-person`,
    bodyFn: (input) => ({ name: input.name }),
  }),
  refreshFaces: createPathMutation<
    { photoId: string },
    { jobId: string; status: string }
  >({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/refresh-faces`,
  }),
  refreshOcr: createPathMutation<
    { photoId: string },
    { jobId: string; status: string }
  >({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/refresh-ocr`,
  }),
  refreshClip: createPathMutation<
    { photoId: string },
    { jobId: string; status: string }
  >({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/refresh-clip`,
  }),
  refreshExif: createPathMutation<{ photoId: string }, { status: string }>({
    method: "POST",
    pathFn: (input) =>
      `/api/apps/photo/item/${enc(input.photoId)}/refresh-exif`,
  }),
  refreshThumbnail: createPathMutation<{ photoId: string }, { status: string }>(
    {
      method: "POST",
      pathFn: (input) =>
        `/api/apps/photo/item/${enc(input.photoId)}/refresh-thumbnail`,
    },
  ),
  getPhotoOcrResults: createQuery<{ photoId: string }, PhotoOcrResultItem[]>({
    path: "/api/apps/photo/item/{id}/ocr-results",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/ocr-results`,
  }),
  createOcrResult: createPathMutation<
    {
      photoId: string;
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      corners?: [number, number][];
    },
    PhotoOcrResultItem
  >({
    method: "POST",
    pathFn: (input) => `/api/apps/photo/item/${enc(input.photoId)}/ocr-results`,
    bodyFn: (input) => {
      const { photoId: _, ...body } = input;
      return body;
    },
  }),

  // ── OCR result CRUD (non-scoped) ──
  updateOcrResult: createPathMutation<
    {
      ocrResultId: number;
      text?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      angle?: number;
      corners?: [number, number][];
    },
    PhotoOcrResultItem
  >({
    method: "PATCH",
    pathFn: (input) =>
      `/api/apps/photo/ocr-results/${enc(String(input.ocrResultId))}`,
    bodyFn: (input) => {
      const { ocrResultId: _, ...body } = input;
      return body;
    },
  }),
  deleteOcrResult: createPathMutation<{ ocrResultId: number }, void>({
    method: "DELETE",
    pathFn: (input) =>
      `/api/apps/photo/ocr-results/${enc(String(input.ocrResultId))}`,
  }),

  getSyncProgress: createQuery<{ id: string }, SyncProgressOutput>({
    path: "/api/apps/photo/{id}/sync-progress",
    pathFn: (input) => `/api/apps/photo/${enc(input.id)}/sync-progress`,
  }),

  // ── Settings (global) ──
  getGeoSettings: createQuery<void, PhotoGeoSettings>({
    path: "/api/apps/photo/settings/geo",
  }),
  updateGeoSettings: createMutation<PhotoGeoSettings, PhotoGeoSettings>({
    method: "PUT",
    path: "/api/apps/photo/settings/geo",
  }),
  testGeoConnection: createMutation<
    void,
    {
      results: Array<{
        name: string;
        success: boolean;
        detail: string;
      }>;
    }
  >({
    path: "/api/apps/photo/settings/geo/test",
  }),
  getAiSettings: createQuery<void, PhotoAiSettings>({
    path: "/api/apps/photo/settings/ai",
  }),
  updateAiSettings: createMutation<PhotoAiSettings, PhotoAiSettings>({
    method: "PUT",
    path: "/api/apps/photo/settings/ai",
  }),
  testAiConnection: createMutation<
    void,
    {
      results: Array<{
        name: string;
        success: boolean;
        detail: string;
        modelsReady?: boolean;
      }>;
    }
  >({
    path: "/api/apps/photo/settings/ai/test",
  }),
} as const;

const vfsApi = {
  list: {
    queryKey: ["vfs", "list"] as const,
    useQuery: (
      opts?: Partial<UseQueryOptions<VfsDto[], Error, VfsDto[], QueryKey>>,
    ) =>
      useQuery<VfsDto[], Error, VfsDto[], QueryKey>({
        queryKey: ["vfs", "list"],
        queryFn: () => vfsFetch<VfsDto[]>("/"),
        ...opts,
      }),
    fetch: () => vfsFetch<VfsDto[]>("/"),
    invalidate: (qc: ReturnType<typeof useQueryClient>) =>
      qc.invalidateQueries({ queryKey: ["vfs", "list"] }),
  },
  browse: (
    fileSystemId: string | undefined,
    path: string,
  ): Promise<BrowseDirectoryResponse> =>
    fileSystemId
      ? vfsFetch<BrowseDirectoryResponse>(
          `/${encodeURIComponent(fileSystemId)}/browse?path=${encodeURIComponent(path)}`,
        )
      : vfsFetch<BrowseDirectoryResponse>(
          `/local/browse?path=${encodeURIComponent(path)}`,
        ),
  stat: (
    paths: string[],
    fileSystemId: string | undefined,
  ): Promise<SourceStatEntry[]> =>
    fileSystemId
      ? vfsFetch<SourceStatEntry[]>(
          `/${encodeURIComponent(fileSystemId)}/stat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
          },
        )
      : vfsFetch<SourceStatEntry[]>("/local/stat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths }),
        }),
} as const;

export const api = { photo: photoApi, vfs: vfsApi } as const;
