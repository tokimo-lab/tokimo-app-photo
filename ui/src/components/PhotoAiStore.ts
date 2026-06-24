import { useSyncExternalStore } from "react";

interface PhotoAiState {
  hoveredFaceId: number | null;
  hoveredOcrId: string | null;
  editingOcrId: string | null;
  pendingBbox: {
    x: number;
    y: number;
    w: number;
    h: number;
    angle?: number;
    corners?: [number, number][];
  } | null;
  ocrSelectionRanges: Map<string, { start: number; end: number }>;
}

function createEmptyState(): PhotoAiState {
  return {
    hoveredFaceId: null,
    hoveredOcrId: null,
    editingOcrId: null,
    pendingBbox: null,
    ocrSelectionRanges: new Map(),
  };
}

const stores = new Map<string, PhotoAiState>();
const listeners = new Map<string, Set<() => void>>();

function getStore(photoId: string): PhotoAiState {
  let state = stores.get(photoId);
  if (!state) {
    state = createEmptyState();
    stores.set(photoId, state);
  }
  return state;
}

function getListeners(photoId: string): Set<() => void> {
  let set = listeners.get(photoId);
  if (!set) {
    set = new Set();
    listeners.set(photoId, set);
  }
  return set;
}

function emit(photoId: string): void {
  for (const cb of getListeners(photoId)) cb();
}

export function subscribe(photoId: string, callback: () => void): () => void {
  const set = getListeners(photoId);
  set.add(callback);
  return () => {
    set.delete(callback);
    if (set.size === 0) {
      listeners.delete(photoId);
      stores.delete(photoId);
    }
  };
}

export function getSnapshot(photoId: string): PhotoAiState {
  return getStore(photoId);
}

export function setHoveredFaceId(
  photoId: string,
  faceId: number | null,
): void {
  const state = getStore(photoId);
  if (state.hoveredFaceId === faceId) return;
  state.hoveredFaceId = faceId;
  emit(photoId);
}

export function setHoveredOcrId(photoId: string, ocrId: string | null): void {
  const state = getStore(photoId);
  if (state.hoveredOcrId === ocrId) return;
  state.hoveredOcrId = ocrId;
  emit(photoId);
}

export function setEditingOcrId(photoId: string, ocrId: string | null): void {
  const state = getStore(photoId);
  if (state.editingOcrId === ocrId) return;
  state.editingOcrId = ocrId;
  state.pendingBbox = null;
  emit(photoId);
}

export function setPendingBbox(
  photoId: string,
  bbox: PhotoAiState["pendingBbox"],
): void {
  const state = getStore(photoId);
  state.pendingBbox = bbox;
  emit(photoId);
}

export function setOcrSelectionRanges(
  photoId: string,
  ranges: Map<string, { start: number; end: number }>,
): void {
  const state = getStore(photoId);
  state.ocrSelectionRanges = ranges;
  emit(photoId);
}

const subscribeCache = new Map<string, (cb: () => void) => () => void>();
const getSnapshotCache = new Map<string, () => PhotoAiState>();

function getStableSubscribe(photoId: string): (cb: () => void) => () => void {
  let fn = subscribeCache.get(photoId);
  if (!fn) {
    fn = (cb: () => void) => subscribe(photoId, cb);
    subscribeCache.set(photoId, fn);
  }
  return fn;
}

function getStableGetSnapshot(photoId: string): () => PhotoAiState {
  let fn = getSnapshotCache.get(photoId);
  if (!fn) {
    fn = () => getSnapshot(photoId);
    getSnapshotCache.set(photoId, fn);
  }
  return fn;
}

export function usePhotoAiState(photoId: string): PhotoAiState {
  return useSyncExternalStore(
    getStableSubscribe(photoId),
    getStableGetSnapshot(photoId),
  );
}
