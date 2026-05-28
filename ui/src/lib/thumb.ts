import { rustUrl } from "./rust-api-runtime";

export type ThumbEntityType = "photo" | "person" | "album" | "user";

export function thumbUrl(
  type: ThumbEntityType,
  id: string,
  w: number,
  h = 0,
): string {
  return rustUrl(`/api/thumb/${type}/${encodeURIComponent(id)}?w=${w}&h=${h}`);
}
