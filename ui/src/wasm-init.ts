import initWasm, * as photoWasm from "./wasm/generated/tokimo_app_photo_wasm";

export type PhotoWasmModule = typeof photoWasm;
export type OcrEngineInstance = InstanceType<typeof photoWasm.OcrEngine>;

let wasmModule: PhotoWasmModule | null = null;
let loadPromise: Promise<PhotoWasmModule> | null = null;

function wasmAssetUrl(): URL {
  const wasmPath = "wasm/tokimo_app_photo_wasm_bg.wasm";
  return new URL(wasmPath, import.meta.url);
}

function ensureWasmLoaded(): Promise<PhotoWasmModule> {
  if (wasmModule) return Promise.resolve(wasmModule);
  if (loadPromise) return loadPromise;

  loadPromise = initWasm(wasmAssetUrl()).then(() => {
    wasmModule = photoWasm;
    return photoWasm;
  });
  return loadPromise;
}

export { wasmModule, ensureWasmLoaded };
