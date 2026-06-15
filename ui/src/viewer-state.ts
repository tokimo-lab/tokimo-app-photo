/**
 * External store for coordinating hover/edit state between
 * image overlays and info panel in the photo viewer extension.
 */

import { useSyncExternalStore } from "react";

type Listener = () => void;

interface ViewerState {
  hoveredFaceId: string | null;
  hoveredOcrId: string | null;
  editingOcrId: string | null;
  ocrSelectionRanges: Array<{ start: number; end: number }> | null;
  pendingBbox: unknown | null;
}

const state: ViewerState = {
  hoveredFaceId: null,
  hoveredOcrId: null,
  editingOcrId: null,
  ocrSelectionRanges: null,
  pendingBbox: null,
};

const listeners = new Set<Listener>();

function notify() {
  for (const l of listeners) l();
}

export function getViewerState(): Readonly<ViewerState> {
  return state;
}

export function setHoveredFaceId(id: string | null) {
  if (state.hoveredFaceId !== id) {
    state.hoveredFaceId = id;
    notify();
  }
}

export function setHoveredOcrId(id: string | null) {
  if (state.hoveredOcrId !== id) {
    state.hoveredOcrId = id;
    notify();
  }
}

export function setEditingOcrId(id: string | null) {
  if (state.editingOcrId !== id) {
    state.editingOcrId = id;
    notify();
  }
}

export function setOcrSelectionRanges(
  ranges: Array<{ start: number; end: number }> | null,
) {
  state.ocrSelectionRanges = ranges;
  notify();
}

export function setPendingBbox(bbox: unknown | null) {
  state.pendingBbox = bbox;
  notify();
}

export function subscribeViewerState(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook for subscribing to viewer state changes. */
export function useViewerState(): Readonly<ViewerState> {
  return useSyncExternalStore(subscribeViewerState, getViewerState);
}
