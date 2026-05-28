import { Camera } from "lucide-react";

export function AppIcon({ icon, color, size = 20 }: { icon?: string; color?: string; size?: number }) {
  const label = icon?.trim();
  const initial = label ? Array.from(label)[0] : null;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg text-white"
      style={{ width: size, height: size, backgroundColor: color ?? "#10b981" }}
    >
      {initial ? <span className="text-[10px] font-semibold leading-none">{initial}</span> : <Camera size={Math.max(12, size - 8)} />}
    </span>
  );
}
