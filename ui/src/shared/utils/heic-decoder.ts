import libheif from "libheif-js/wasm-bundle";

const HEIC_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const HEIC_EXTENSIONS = new Set([".heic", ".heif"]);

/** Check by MIME type or filename extension */
export function isHeicFile(
  mimeType?: string | null,
  filename?: string | null,
): boolean {
  if (mimeType && HEIC_MIME_TYPES.has(mimeType.toLowerCase())) return true;
  if (filename) {
    const lower = filename.toLowerCase();
    for (const ext of HEIC_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
  }
  return false;
}

/** Check if a Blob has HEIC content-type */
function isHeicBlob(blob: Blob): boolean {
  return HEIC_MIME_TYPES.has(blob.type.toLowerCase());
}

/**
 * Decode a HEIC image using libheif WASM and render to a JPEG Blob via Canvas.
 */
function decodeHeifImage(
  heifImage: InstanceType<typeof libheif.HeifImage>,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = heifImage.get_width();
    const h = heifImage.get_height();
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Failed to get 2d context"));
      return;
    }
    const imageData = ctx.createImageData(w, h);
    heifImage.display(imageData, (result: ImageData | null) => {
      if (!result) {
        reject(new Error("HEIF decode failed"));
        return;
      }
      ctx.putImageData(result, 0, 0);
      canvas
        .convertToBlob({ type: "image/jpeg", quality: 0.92 })
        .then(resolve)
        .catch(reject);
    });
  });
}

/**
 * Pick the primary (largest) image from decoded HEIC container.
 * iPhone HEIC files may contain multiple images (main + gain map).
 */
function findPrimaryImage(
  images: InstanceType<typeof libheif.HeifImage>[],
): InstanceType<typeof libheif.HeifImage> {
  if (images.length === 1) return images[0];
  // Try is_primary() — may not be available in all libheif builds
  try {
    const primary = images.find((img) => img.is_primary());
    if (primary) return primary;
  } catch {
    // is_primary() not supported — fall through to size-based selection
  }
  // Fallback: pick the largest by pixel count
  let best = images[0];
  let bestPixels = best.get_width() * best.get_height();
  for (let i = 1; i < images.length; i++) {
    const px = images[i].get_width() * images[i].get_height();
    if (px > bestPixels) {
      best = images[i];
      bestPixels = px;
    }
  }
  return best;
}

/** Convert HEIC blob to JPEG using WASM (libheif). Returns the original blob if not HEIC. */
export async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  if (!isHeicBlob(blob)) return blob;
  const buffer = await blob.arrayBuffer();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buffer));
  if (!images || images.length === 0) {
    throw new Error("No images found in HEIC file");
  }
  return decodeHeifImage(findPrimaryImage(images));
}

// --- Web Worker based off-thread HEIC conversion ---

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (b: Blob) => void; reject: (e: Error) => void }
>();

function getHeicWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./heic-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent) => {
      const { id, blob, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(blob);
    };
  }
  return worker;
}

/** Convert HEIC blob to JPEG in a Web Worker (does NOT block main thread). */
export function convertHeicToJpegOffThread(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    blob
      .arrayBuffer()
      .then((buffer) => {
        getHeicWorker().postMessage({ id, buffer }, [buffer]);
      })
      .catch(reject);
  });
}
