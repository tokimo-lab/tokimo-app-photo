import { ensureWasmLoaded } from "../../wasm-init";

const RAW_EXTENSIONS = new Set([
  ".dng",
  ".cr2",
  ".cr3",
  ".nef",
  ".arw",
  ".orf",
  ".rw2",
  ".pef",
  ".srw",
  ".raf",
  ".raw",
]);

/** Check if a filename has a RAW camera extension. */
export function isRawFile(filename?: string | null): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  for (const ext of RAW_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * Extract the embedded JPEG preview from a DNG/RAW file via tokimo-wasm.
 * DNG files contain full-res JPEG previews — extracting them is fast
 * and avoids the memory-heavy demosaicing pipeline.
 *
 * Returns the JPEG Blob, or null if no embedded preview was found.
 */
export async function extractRawPreview(blob: Blob): Promise<Blob | null> {
  const mod = await ensureWasmLoaded();
  const buffer = await blob.arrayBuffer();
  const jpegBytes = (
    mod as unknown as Record<string, (b: Uint8Array) => Uint8Array | null>
  ).extractRawPreview(new Uint8Array(buffer));
  if (!jpegBytes) return null;
  return new Blob([jpegBytes.slice()], { type: "image/jpeg" });
}
