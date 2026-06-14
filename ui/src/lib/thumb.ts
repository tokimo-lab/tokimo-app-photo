import { rustUrl } from "./rust-api-runtime";

/**
 * Entity types supported by the unified thumbnail endpoint.
 *
 * Maps to `ThumbnailResolver` entity types in `rust-server`.
 */
export type ThumbEntityType =
  | "photo"
  | "movie"
  | "tvshow"
  | "season"
  | "episode"
  | "person"
  | "album"
  | "book"
  | "book"
  | "user";

/**
 * Build a URL for the unified entity-based thumbnail endpoint.
 *
 * `GET /api/thumb/{entity_type}/{entity_id}?w={w}&h={h}`
 *
 * Backend checks S3 cache first; on miss fetches original from VFS/S3/HTTP,
 * generates thumbnail, caches, and returns.
 * Returns `Cache-Control: public, max-age=604800, immutable`.
 */
export function thumbUrl(
  type: ThumbEntityType,
  id: string,
  w: number,
  h = 0,
): string {
  return rustUrl(`/api/thumb/${type}/${id}?w=${w}&h=${h}`);
}

/**
 * Build a CDN-style URL for an S3/storage key thumbnail.
 *
 * `GET /storage/{key}?w={w}&h={h}&format={format}`
 *
 * The storage endpoint generates + caches the thumbnail inline.
 * No DB lookup required — only the storage key is needed.
 */
export function thumbStorageUrl(
  storageKey: string,
  w: number,
  h = 0,
  format = "webp",
): string {
  return rustUrl(`/storage/${storageKey}?w=${w}&h=${h}&format=${format}`);
}

/**
 * Smart poster URL resolver for components that receive a raw `posterPath`
 * from the DB without a separate entity ID.
 *
 * Handles all path formats produced by the backend:
 * - `/storage/{key}` → `thumbStorageUrl` (CDN thumbnail via storage endpoint)
 * - `http(s)://…`    → returned as-is (external CDN, e.g. TMDB)
 * - TMDB relative path (e.g. `/xxxx.jpg`) → TMDB image CDN with size param
 *
 * @param posterPath  Raw path from DB / API response
 * @param w           Desired thumbnail width in pixels
 * @param format      Output format (default: "webp")
 */
export function posterThumbUrl(
  posterPath: string | null | undefined,
  w: number,
  format = "webp",
): string | undefined {
  if (!posterPath) return undefined;

  if (posterPath.startsWith("/storage/")) {
    return thumbStorageUrl(posterPath.slice(9), w, 0, format);
  }
  if (posterPath.startsWith("http")) {
    return posterPath;
  }
  if (posterPath.startsWith("/")) {
    return `https://image.tmdb.org/t/p/w500${posterPath}`;
  }
  return undefined;
}
