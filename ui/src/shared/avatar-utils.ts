import type { AvatarData } from "../types/avatar";

/** Parse a JSON value from the API into a typed AvatarData, or null */
export function parseAvatar(value: unknown): AvatarData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (
    obj.type === "text" &&
    typeof obj.text === "string" &&
    typeof obj.color === "string"
  ) {
    return { type: "text", text: obj.text, color: obj.color };
  }
  if (
    obj.type === "icon" &&
    typeof obj.icon === "string" &&
    typeof obj.color === "string"
  ) {
    return { type: "icon", icon: obj.icon, color: obj.color };
  }
  if (obj.type === "image" && typeof obj.src === "string") {
    return { type: "image", src: obj.src };
  }
  return null;
}

/** Extract icon string from avatar JSONB for `<AppIcon icon={...} />` */
export function getAvatarIcon(avatar: unknown): string | undefined {
  const parsed = parseAvatar(avatar);
  if (!parsed) return undefined;
  if (parsed.type === "icon") return parsed.icon;
  if (parsed.type === "text") return parsed.text;
  return undefined;
}

/** Extract color string from avatar JSONB for `<AppIcon color={...} />` */
export function getAvatarColor(avatar: unknown): string | undefined {
  const parsed = parseAvatar(avatar);
  if (!parsed) return undefined;
  if (parsed.type === "text" || parsed.type === "icon") return parsed.color;
  return undefined;
}

/** Extract image src from avatar JSONB */
export function getAvatarImageSrc(avatar: unknown): string | undefined {
  const parsed = parseAvatar(avatar);
  if (parsed?.type === "image") return parsed.src;
  return undefined;
}
