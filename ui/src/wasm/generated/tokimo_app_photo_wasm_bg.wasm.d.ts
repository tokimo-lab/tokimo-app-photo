/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const wasmBuildTime: () => [number, number];
export const wasmGitCommit: () => [number, number];
export const wasmVersion: () => [number, number];
export const __wbg_ocrengine_free: (a: number, b: number) => void;
export const ocrengine_blockCount: (a: number) => number;
export const ocrengine_computeCharPositions: (a: number, b: number, c: number) => [number, number];
export const ocrengine_computeHighlights: (a: number, b: number, c: number, d: number, e: number) => [number, number];
export const ocrengine_extractText: (a: number, b: number, c: number, d: number, e: number) => [number, number];
export const ocrengine_getVisualOrder: (a: number) => [number, number];
export const ocrengine_hitTest: (a: number, b: number, c: number, d: number) => any;
export const ocrengine_new: () => number;
export const ocrengine_recomputeVisualOrder: (a: number, b: number) => void;
export const ocrengine_setBlocks: (a: number, b: number, c: number, d: any, e: number) => void;
export const ocrengine_visualRank: (a: number, b: number) => number;
export const extractRawPreview: (a: number, b: number) => [number, number];
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
