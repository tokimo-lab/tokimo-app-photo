/**
 * 将 S3 存储 key 转为可访问的完整 URL。
 *
 * - 开发模式（Vite DEV 且 RUST_SERVER 已设置）：直连 localhost:5678/storage/{key}，不经过 Vite
 * - 生产模式：返回 /storage/{key}，由 Nginx 代理到后端
 */

import { rustUrl } from "@/lib/rust-api-runtime";

export function storageUrl(key: string): string {
  return rustUrl(`/storage/${key}`);
}

/**
 * 将 DB 中存储的路径（如 `/storage/tmdb-images/...`）转为可访问 URL。
 * 非 /storage/ 开头的路径原样返回。
 */
export function resolveStoragePath(path: string): string {
  if (path.startsWith("/storage/")) {
    return storageUrl(path.slice(9));
  }
  return path;
}
