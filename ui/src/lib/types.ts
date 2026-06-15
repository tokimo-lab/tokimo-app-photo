import type { AccentColor, Lang, PresetAccentColor } from "../types";

export type {
  AccentColor,
  Lang,
  LangMode,
  PresetAccentColor,
  TitleBarStyle,
  User,
  UserSettings,
} from "../types";

export type Theme = "light" | "dark";
export type ThemeMode = "auto" | Theme;

export type TaskbarIconAlign = "left" | "center" | "right";

export type PlayerVisualMode =
  | "vinyl"
  | "bars"
  | "waveform"
  | "circular"
  | "particles"
  | "wave"
  | "spectrogram"
  | "terrain"
  | "matrix"
  | "kaleidoscope"
  | "starfield"
  | "ripple"
  | "flame"
  | "dna"
  | "mosaic"
  | "tunnel"
  | "alchemy"
  | "cover";

export const PLAYER_VISUAL_MODES: PlayerVisualMode[] = [
  "vinyl",
  "bars",
  "waveform",
  "circular",
  "particles",
  "wave",
  "spectrogram",
  "terrain",
  "matrix",
  "kaleidoscope",
  "starfield",
  "ripple",
  "flame",
  "dna",
  "mosaic",
  "tunnel",
  "alchemy",
  "cover",
];

export const ACCENT_COLORS: PresetAccentColor[] = [
  "emerald",
  "amber",
  "rose",
  "violet",
  "blue",
  "cyan",
  "orange",
  "pink",
  "indigo",
  "teal",
  "lime",
  "fuchsia",
  "sky",
  "slate",
  "red",
];

/** Check if an AccentColor is a custom hex value */
export function isCustomAccent(
  color: AccentColor,
): color is `custom:${string}` {
  return color.startsWith("custom:");
}

/** Extract the hex from a custom accent, e.g. "custom:#ff6600" → "#ff6600" */
export function getCustomHex(color: AccentColor): string {
  return color.slice(7); // "custom:".length === 7
}

/**
 * Language native names for display in language selectors
 * Each language is displayed in its own script/language
 * Using BCP 47 language tags (IETF standard)
 */
export const LANG_NAMES: Record<Lang, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
  "ja-JP": "日本語",
};
