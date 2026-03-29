/**
 * Module-level store for sharing photo lists between PhotoAppPage
 * and PhotoWindowViewer (which renders in a separate window tree).
 */

import type { PhotoOutput } from "@/generated/rust-types";

const store = new Map<string, PhotoOutput[]>();

/** Store the current photo list for a given app (called by PhotoAppPage). */
export function setViewerPhotos(appId: string, photos: PhotoOutput[]) {
  store.set(appId, photos);
}

/** Retrieve the photo list for navigation in the windowed viewer. */
export function getViewerPhotos(appId: string): PhotoOutput[] {
  return store.get(appId) ?? [];
}

/** Clean up when photo app closes. */
export function clearViewerPhotos(appId: string) {
  store.delete(appId);
}
