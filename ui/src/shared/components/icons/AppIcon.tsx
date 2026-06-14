import { cn } from "@tokimo/ui";
import { type ComponentType, useState } from "react";
import { isLucideIcon, resolveLucideIcon } from "./icon-utils";

const HASH_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = str.charCodeAt(i) + ((h << 5) - h);
  }
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
}

/**
 * Unified app icon renderer.
 *
 * Supports four icon sources (priority: high → low):
 *   1. `image` — PNG/URL image that fills the container (system app icons,
 *      manifest images, user-uploaded PNGs)
 *   2. `iconComponent` — direct LucideIcon component
 *   3. `icon` string starting with "lucide:" — resolved via icon catalog
 *   4. `icon` string (anything else) — rendered as emoji / text
 *
 * Surface variants:
 *   • default  — iOS-style colored tile (uses `color`, or hashed emoji color,
 *                or no background if Lucide without color)
 *   • neutral  — muted grey surface + tinted icon (used by widget pickers
 *                where icons have no brand color)
 *
 * Used across launchpad, taskbar, menus, settings, window title bars,
 * desktop widgets, quick actions, etc.
 */
export function AppIcon({
  icon,
  iconComponent: IconComponent,
  image,
  color,
  size = 40,
  surface,
  className,
  onClick,
}: {
  icon?: string | null;
  /** Direct LucideIcon component (bypasses string resolution) */
  iconComponent?: ComponentType<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  /** PNG / URL image that fills the container (highest priority) */
  image?: string | null;
  color?: string | null;
  size?: number;
  /**
   * Visual surface style.
   * - undefined (default): iOS-style, colored tile when color/emoji present
   * - "neutral": muted grey surface + tinted icon, matching desktop widget
   *   picker's WidgetCard style
   */
  surface?: "neutral";
  className?: string;
  onClick?: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [prevImage, setPrevImage] = useState(image);
  if (image !== prevImage) {
    setPrevImage(image);
    setImgError(false);
  }
  const useImage = !!image && !imgError;

  const ResolvedIcon = IconComponent ?? resolveLucideIcon(icon);
  const hasEmoji = !useImage && !IconComponent && !isLucideIcon(icon) && !!icon;
  const isNeutral = surface === "neutral";

  // Background resolution:
  //   - image wins: no background (image fills container)
  //   - neutral surface: muted grey (ignores color; color is used as icon tint)
  //   - explicit "transparent": no background
  //   - user color > hashed emoji color > none
  const bgColor = useImage
    ? undefined
    : isNeutral
      ? undefined
      : color === "transparent"
        ? undefined
        : color || (hasEmoji ? hashColor(icon!) : undefined);
  const neutralSurfaceClass =
    isNeutral && !useImage ? "bg-black/[0.05] dark:bg-white/[0.06]" : "";

  // Lucide icons: moderate scale so they don't fill the entire background tile
  const lucideScale = size <= 24 ? 0.6 : 0.45;
  // Text: larger scale to stay readable at small sizes
  const textScale = size <= 24 ? 0.85 : 0.45;

  // Text rules (continuous fit, not tiered):
  //   1. Take first contiguous same-class run (CJK vs ASCII):
  //        "Agent分发器" → "Agent", "测试Agent" → "测试"
  //   2. Hard max char count: ASCII 8, CJK 4.
  //   3. Font caps at 12px (never bigger regardless of container), floors at 8px.
  //   4. Layout: 2 rows when chars > 1, cols = ceil(chars/2).
  //      Font = min(innerSize/(cols·charWidth), innerSize/rows, 12).
  //      If font < 8, drop one char and retry. Chars=1 always renders.
  const { displayText, textFontSize, cols } = (() => {
    if (!hasEmoji || !icon) {
      return {
        displayText: icon,
        textFontSize: size * textScale,
        cols: 1,
      };
    }
    const codepoints = [...icon];
    const isCJK = (c: string) =>
      /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(c) ||
      c.length > 1;

    const firstCJK = isCJK(codepoints[0]!);
    const run: string[] = [];
    for (const c of codepoints) {
      if (isCJK(c) !== firstCJK) break;
      run.push(c);
    }

    const charWidth = firstCJK ? 1.0 : 0.6;
    const maxChars = firstCJK ? 4 : 8;
    const innerSizeLocal = size * 0.75;
    const absMaxFont = Math.max(size * 0.4, 8);
    const minFont = 8;

    let chars = Math.min(run.length, maxChars);
    while (chars >= 1) {
      const rows = chars === 1 ? 1 : 2;
      const c = Math.ceil(chars / rows);
      const fontCap = chars === 1 ? size * 0.65 : absMaxFont;
      const font = Math.min(
        innerSizeLocal / (c * charWidth),
        innerSizeLocal / rows,
        fontCap,
      );
      if (font >= minFont || chars === 1) {
        return {
          displayText: run.slice(0, chars).join(""),
          textFontSize: font,
          cols: c,
        };
      }
      chars--;
    }
    return {
      displayText: run.slice(0, 1).join(""),
      textFontSize: innerSizeLocal,
      cols: 1,
    };
  })();

  // Icon color class:
  //   - image: n/a
  //   - colored bg: white text for contrast
  //   - neutral surface: use user color as tint (via inline style)
  //   - no bg: muted foreground
  const iconColorClass = bgColor
    ? "text-white/90"
    : isNeutral && color
      ? undefined
      : "text-fg-muted";
  const iconInlineColor =
    isNeutral && color && color !== "transparent" ? color : undefined;

  const content = useImage ? (
    <img
      src={image!}
      alt=""
      width={size}
      height={size}
      className="object-cover"
      style={{ width: size, height: size }}
      draggable={false}
      onError={() => setImgError(true)}
    />
  ) : ResolvedIcon ? (
    <ResolvedIcon
      className={iconColorClass}
      style={{
        width: size * lucideScale,
        height: size * lucideScale,
        color: iconInlineColor,
      }}
    />
  ) : hasEmoji ? (
    cols <= 1 ? (
      <span
        className={cn("text-center leading-none", bgColor && "text-white")}
        style={{ fontSize: textFontSize, whiteSpace: "nowrap" as const }}
      >
        {displayText}
      </span>
    ) : (
      (() => {
        const chars = [...(displayText ?? "")];
        const rows: string[][] = [];
        for (let r = 0; r < Math.ceil(chars.length / cols); r++) {
          rows.push(chars.slice(r * cols, (r + 1) * cols));
        }
        return (
          <div
            className={cn(
              "flex flex-col leading-none",
              bgColor && "text-white",
            )}
            style={{ fontSize: textFontSize }}
          >
            {rows.map((row, ri) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static rows
              <div key={ri} className="flex justify-center">
                {row.map((ch, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static chars
                  <span key={ci}>{ch}</span>
                ))}
              </div>
            ))}
          </div>
        );
      })()
    )
  ) : null;

  const baseClass =
    "rounded-[20%] flex items-center justify-center select-none shrink-0 overflow-hidden";

  if (onClick) {
    return (
      <button
        type="button"
        data-app-icon
        className={cn(
          baseClass,
          neutralSurfaceClass,
          "cursor-pointer hover:ring-4 hover:ring-black/10 dark:hover:ring-white/10 transition-all",
          className,
        )}
        style={{
          width: size,
          height: size,
          backgroundColor: bgColor,
        }}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-app-icon
      className={cn(baseClass, neutralSurfaceClass, className)}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
      }}
    >
      {content}
    </div>
  );
}
