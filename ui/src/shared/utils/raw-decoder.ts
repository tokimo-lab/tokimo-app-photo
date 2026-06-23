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

type WasmModule = typeof import("../../../public/wasm/tokimo_app_photo_wasm");

const WASM_BASE = "http://localhost:5173/wasm";

let _wasmPromise: Promise<WasmModule> | null = null;

function loadWasm(): Promise<WasmModule> {
  if (!_wasmPromise) {
    const wb = (globalThis as unknown as { wasm_bindgen?: WasmModule & ((wasmUrl: string) => Promise<unknown>) }).wasm_bindgen;
    if (wb && typeof wb.extractRawPreview === 'function') {
      _wasmPromise = Promise.resolve(wb);
    } else {
      _wasmPromise = new Promise<WasmModule>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "./wasm/tokimo_app_photo_wasm.js";
        script.onload = () => {
          const wb2 = (globalThis as unknown as { wasm_bindgen: WasmModule & ((wasmUrl: string) => Promise<unknown>) }).wasm_bindgen;
          (wb2 as unknown as (wasmUrl: string) => Promise<unknown>)("./wasm/tokimo_app_photo_wasm_bg.wasm")
            .then(() => resolve(wb2))
            .catch(reject);
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  }
  return _wasmPromise;
}
  return _wasmPromise;
}

/**
 * Extract the embedded JPEG preview from a DNG/RAW file via tokimo-wasm.
 * DNG files contain full-res JPEG previews — extracting them is fast
 * and avoids the memory-heavy demosaicing pipeline.
 *
 * Returns the JPEG Blob, or null if no embedded preview was found.
 */
export async function extractRawPreview(blob: Blob): Promise<Blob | null> {
  const wasm = await loadWasm();
  const buffer = await blob.arrayBuffer();
  const jpegBytes = (
    wasm as unknown as Record<string, (b: Uint8Array) => Uint8Array | null>
  ).extractRawPreview(new Uint8Array(buffer));
  if (!jpegBytes) return null;
  return new Blob([jpegBytes.slice()], { type: "image/jpeg" });
}
