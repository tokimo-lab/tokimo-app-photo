/* tslint:disable */
/* eslint-disable */

/**
 * OCR engine holding block data for hit testing and selection.
 *
 * JS workflow:
 * 1. `new OcrEngine()`
 * 2. `set_blocks(data, texts)` when OCR results arrive
 * 3. `hit_test(x, y, anchor)` on pointer events
 * 4. `compute_highlights(...)` / `extract_text(...)` for rendering
 */
export class OcrEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns the number of loaded blocks.
     */
    blockCount(): number;
    /**
     * Compute character positions from Canvas measureText widths.
     * Static utility — does not require blocks to be loaded.
     * Returns Float32Array: [x0, w0, x1, w1, ...]
     */
    static computeCharPositions(widths: Float32Array, block_w: number): Float32Array;
    /**
     * Compute highlight rectangles for the selection range.
     * Returns Float32Array: [x, y, w, h, angle, ox, oy, ...] (stride 7).
     * ox/oy is the transform-origin relative to the highlight div (block center).
     * Blocks are iterated in visual reading order for correct rotated selections.
     */
    computeHighlights(anchor_block: number, anchor_char: number, focus_block: number, focus_char: number): Float32Array;
    /**
     * Extract selected text from the selection range.
     * Iterates blocks in visual reading order.
     */
    extractText(anchor_block: number, anchor_char: number, focus_block: number, focus_char: number): string;
    /**
     * Get the full visual order mapping: visual_order[rank] = block_index.
     * Returns Uint32Array.
     */
    getVisualOrder(): Uint32Array;
    /**
     * Hit test at (x, y) in scaled image coordinates.
     * `anchor_block_idx`: -1 if no anchor, otherwise the anchor block index
     * for paragraph-aware nearest-block finding.
     *
     * Returns a JS object `{ blockIdx, charIdx }` or `null`.
     */
    hitTest(x: number, y: number, anchor_block_idx: number): any;
    constructor();
    /**
     * Recompute visual reading order using the anchor block's rotation angle.
     * Call this on each pointer-down, before any selection logic.
     * This ensures images with text at multiple angles get the correct
     * ordering for the currently active selection context.
     */
    recomputeVisualOrder(anchor_block_idx: number): void;
    /**
     * Set OCR blocks from JS.
     *
     * `data`: Float32Array with packed block data. For each block:
     *   [x, y, w, h, angle, paragraph_id, char_count, char_w0, char_w1, ...]
     *
     * If char widths are from backend `char_positions`, they are absolute widths
     * within the block. If from Canvas `measureText`, they are reference widths
     * that need proportional scaling (handled by compute_char_positions internally).
     *
     * `texts`: JS array of strings, one per block.
     * `use_backend_positions`: if true, char widths are pre-computed absolute positions
     *   (from CTC alignment / Attention), stored as [x0, w0, x1, w1, ...] pairs.
     *   If false, char widths are Canvas measureText reference widths that need scaling.
     */
    setBlocks(data: Float32Array, texts: any, use_backend_positions: boolean): void;
    /**
     * Get the visual rank of a block (0 = visually first in reading order).
     * Used by frontend to normalize cross-block selections.
     */
    visualRank(block_idx: number): number;
}

/**
 * Extract the largest embedded JPEG preview from a DNG/TIFF RAW file.
 *
 * Returns the JPEG bytes, or `null` if no embedded preview is found.
 */
export function extractRawPreview(data: Uint8Array): Uint8Array | undefined;

export function wasmBuildTime(): string;

export function wasmGitCommit(): string;

export function wasmVersion(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasmBuildTime: () => [number, number];
    readonly wasmGitCommit: () => [number, number];
    readonly wasmVersion: () => [number, number];
    readonly extractRawPreview: (a: number, b: number) => [number, number];
    readonly __wbg_ocrengine_free: (a: number, b: number) => void;
    readonly ocrengine_blockCount: (a: number) => number;
    readonly ocrengine_computeCharPositions: (a: number, b: number, c: number) => [number, number];
    readonly ocrengine_computeHighlights: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly ocrengine_extractText: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly ocrengine_getVisualOrder: (a: number) => [number, number];
    readonly ocrengine_hitTest: (a: number, b: number, c: number, d: number) => any;
    readonly ocrengine_new: () => number;
    readonly ocrengine_recomputeVisualOrder: (a: number, b: number) => void;
    readonly ocrengine_setBlocks: (a: number, b: number, c: number, d: any, e: number) => void;
    readonly ocrengine_visualRank: (a: number, b: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
