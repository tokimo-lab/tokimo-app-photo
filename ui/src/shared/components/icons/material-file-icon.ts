/**
 * Material Icon Theme integration for file/folder icons.
 *
 * Uses `generateManifest()` from `material-icon-theme` to map
 * filenames / extensions → icon names, then resolves them to SVG URLs
 * served from `/material-icons/`.
 */

import { generateManifest, type Manifest } from "material-icon-theme";

const manifest: Manifest = generateManifest();

/** Extract all dot-separated extensions, e.g. "foo.spec.ts" → ["spec.ts", "ts"] */
function getAllExtensions(fileName: string): string[] {
  const lower = fileName.toLowerCase();
  const exts: string[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === ".") exts.push(lower.slice(i + 1));
  }
  return exts;
}

/** Resolve icon definition name to a served SVG URL */
function iconUrl(name: string): string {
  const def = manifest.iconDefinitions?.[name];
  if (def?.iconPath) {
    const svgFile = def.iconPath.split("/").pop();
    return `/material-icons/${svgFile}`;
  }
  return `/material-icons/${name}.svg`;
}

interface MaterialIconResult {
  url: string;
  /** true when no specific icon was matched (generic file/folder) */
  isDefault: boolean;
}

/**
 * Resolve the material icon URL for a given file or folder.
 */
export function getMaterialIcon(
  fileName: string,
  isDirectory: boolean,
): MaterialIconResult {
  const lowerName = fileName.toLowerCase();

  if (isDirectory) {
    if (manifest.folderNames?.[fileName])
      return {
        url: iconUrl(manifest.folderNames[fileName]),
        isDefault: false,
      };
    if (manifest.folderNames?.[lowerName])
      return {
        url: iconUrl(manifest.folderNames[lowerName]),
        isDefault: false,
      };
    return { url: iconUrl("folder"), isDefault: true };
  }

  // File: try exact filename match first
  if (manifest.fileNames?.[fileName])
    return { url: iconUrl(manifest.fileNames[fileName]), isDefault: false };
  if (manifest.fileNames?.[lowerName])
    return { url: iconUrl(manifest.fileNames[lowerName]), isDefault: false };

  // Try all extensions (e.g. "test.spec.ts" → "spec.ts", "ts")
  const exts = getAllExtensions(fileName);
  for (const ext of exts) {
    if (manifest.fileExtensions?.[ext])
      return { url: iconUrl(manifest.fileExtensions[ext]), isDefault: false };
    if (manifest.languageIds?.[ext])
      return { url: iconUrl(manifest.languageIds[ext]), isDefault: false };
  }

  return { url: iconUrl("file"), isDefault: true };
}
