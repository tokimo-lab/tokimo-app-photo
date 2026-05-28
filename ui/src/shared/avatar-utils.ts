export function getAvatarIcon(avatar: unknown): string | undefined {
  if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) return undefined;
  const value = avatar as Record<string, unknown>;
  if (typeof value.icon === "string") return value.icon;
  if (typeof value.text === "string") return value.text;
  return undefined;
}

export function getAvatarColor(avatar: unknown): string | undefined {
  if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) return undefined;
  const color = (avatar as Record<string, unknown>).color;
  return typeof color === "string" ? color : undefined;
}
