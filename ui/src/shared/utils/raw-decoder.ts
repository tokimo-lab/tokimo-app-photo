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

export function isRawFile(filename?: string | null): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  for (const ext of RAW_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export async function extractRawPreview(_blob: Blob): Promise<Blob | null> {
  // The copied in-tree RAW preview extractor depends on tokimo-wasm, whose
  // bundler-generated wasm import is not loadable by the sidecar Vite build yet.
  // Returning null keeps PhotoLightbox functional by falling back to the server's
  // JPEG conversion endpoint when RAW preview extraction is unavailable here.
  return null;
}
