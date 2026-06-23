/**
 * PhotoExtension implementation for tokimo-app-photo.
 * Injects AI enhancement UI into the shell's image viewer via extension slots.
 *
 * Wraps output in RuntimeProvider since the shell's window tree doesn't provide it.
 */

import type { AppRuntimeCtx, PhotoExtension, PhotoInfo, PhotoDisplayContext } from "@tokimo/sdk";
import { RuntimeProvider } from "@tokimo/sdk";
import { Component, createElement, useEffect, useState } from "react";
import { api } from "./generated/rust-api";
import {
  setHoveredFaceId,
  setHoveredOcrId,
  setEditingOcrId,
  setOcrSelectionRanges,
  useViewerState,
} from "./viewer-state";
import {
  FaceHighlightOverlay,
  OcrHighlightOverlay,
} from "./components/photo-overlays";
import { OcrBlockSelectLayer } from "./components/OcrBlockSelectLayer";
import { OcrBboxEditOverlay } from "./components/OcrBboxEditOverlay";

class SafeOverlay extends Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

export function createPhotoExtension(ctx: AppRuntimeCtx): PhotoExtension {
  return {
    renderImageOverlays(photo: PhotoInfo, displayCtx: PhotoDisplayContext) {
      return createElement(RuntimeProvider, { value: ctx },
        createElement(ImageOverlays, { photo, ctx: displayCtx }),
      );
    },
    renderInfoPanelExtras(photo: PhotoInfo) {
      return createElement(RuntimeProvider, { value: ctx },
        createElement(InfoPanelExtras, { photo }),
      );
    },
  };
}

// ── Image Overlays ───────────────────────────────────────────────────────────

function ImageOverlays({
  photo,
  ctx,
}: {
  photo: PhotoInfo;
  ctx: PhotoDisplayContext;
}) {
  const viewerState = useViewerState();
  const photoId = photo.id;

  const detailQuery = api.photo.getPhoto.useQuery(
    { photoId },
    { enabled: !!photoId },
  );
  const detail = detailQuery.data;

  const facesQuery = api.photo.getPhotoFaces.useQuery(
    { photoId },
    { enabled: !!photoId },
  );
  const faces = facesQuery.data ?? [];

  const ocrQuery = api.photo.getPhotoOcrResults.useQuery(
    { photoId },
    { enabled: !!photoId },
  );
  const ocrResults = ocrQuery.data ?? [];

  const imgRef = ctx.imgRef;
  const photoWidth = detail?.width ?? 0;
  const photoHeight = detail?.height ?? 0;

  if (!photoWidth || !photoHeight) return null;

  try {
    return createElement("div", { className: "pointer-events-none absolute inset-0" },
      ocrResults.length > 0 && viewerState.editingOcrId == null
        ? createElement(OcrBlockSelectLayer, {
            ocrResults,
            photoWidth,
            photoHeight,
            imgRef,
            isZoomed: ctx.zoom > 1,
            onSelectionRanges: setOcrSelectionRanges,
            orientation: detail?.orientation,
          })
        : null,
      viewerState.editingOcrId && ocrResults.length > 0
        ? createElement(SafeOverlay, null,
            createElement(OcrBboxEditOverlay, {
              ocrResults,
              editingOcrId: viewerState.editingOcrId,
              photoWidth,
              photoHeight,
              imgRef,
              orientation: detail?.orientation,
            }),
          )
        : null,
      viewerState.hoveredFaceId && faces.length > 0
        ? createElement(FaceHighlightOverlay, {
            faces,
            hoveredFaceId: viewerState.hoveredFaceId,
            photoWidth,
            photoHeight,
            imgRef,
            orientation: detail?.orientation,
          })
        : null,
      viewerState.hoveredOcrId && ocrResults.length > 0
        ? createElement(OcrHighlightOverlay, {
            ocrResults,
            hoveredOcrId: viewerState.hoveredOcrId,
            photoWidth,
            photoHeight,
            imgRef,
            orientation: detail?.orientation,
          })
        : null,
    );
  } catch (e) {
    console.error("[ImageOverlays] render error:", e);
    return null;
  }
}

// ── Info Panel Extras ────────────────────────────────────────────────────────

function InfoPanelExtras({ photo }: { photo: PhotoInfo }) {
  const [mod, setMod] = useState<any>(null);
  useEffect(() => {
    import("./components/PhotoInfoPanel").then((m) => setMod(m));
  }, []);

  const photoId = photo.id;

  const detailQuery = api.photo.getPhoto.useQuery(
    { photoId },
    { enabled: !!photoId },
  );
  const detail = detailQuery.data;

  if (!mod || !detail) return null;

  return createElement(mod.PhotoInfoPanel, {
    detail,
    fallbackTitle: photo.filename,
    hoveredFaceId: null,
    onHoverFace: setHoveredFaceId,
    hoveredOcrId: null,
    onHoverOcr: setHoveredOcrId,
    ocrSelectionRanges: null,
    onRefreshComplete: () => {
      detailQuery.refetch();
    },
  });
}
