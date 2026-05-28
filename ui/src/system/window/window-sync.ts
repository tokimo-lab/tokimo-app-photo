export function getDefaultSize(type: string): {
  width: number;
  height: number;
} {
  if (type === "photo-viewer") return { width: 1200, height: 820 };
  return { width: 960, height: 640 };
}
