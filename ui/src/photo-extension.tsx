/**
 * PhotoExtension implementation for tokimo-app-photo.
 * Injects AI enhancement UI into the shell's image viewer via extension slots.
 *
 * Wraps output in RuntimeProvider since the shell's window tree doesn't provide it.
 */

import type { AppRuntimeCtx, PhotoExtension, PhotoInfo, PhotoDisplayContext } from "@tokimo/sdk";
import { RuntimeProvider } from "@tokimo/sdk";
import { createElement, useEffect, useMemo, useState } from "react";
import { api } from "./generated/rust-api";
import {
  setHoveredFaceId,
  setHoveredOcrId,
  setEditingOcrId,
  useViewerState,
} from "./viewer-state";

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

  return createElement("div", { className: "pointer-events-none absolute inset-0" },
    viewerState.hoveredFaceId && faces.length > 0
      ? createElement(FaceHighlightOverlayLazy, {
          faces,
          hoveredFaceId: viewerState.hoveredFaceId,
          photoWidth,
          photoHeight,
          imgRef,
          orientation: detail?.orientation,
        })
      : null,
    viewerState.hoveredOcrId && ocrResults.length > 0
      ? createElement(OcrHighlightOverlayLazy, {
          ocrResults,
          hoveredOcrId: viewerState.hoveredOcrId,
          photoWidth,
          photoHeight,
          imgRef,
          orientation: detail?.orientation,
        })
      : null,
  );
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

// ── Lazy wrappers ────────────────────────────────────────────────────────────

function FaceHighlightOverlayLazy(props: any) {
  const [mod, setMod] = useState<any>(null);
  useEffect(() => {
    import("./components/photo-overlays").then((m) => setMod(m));
  }, []);
  if (!mod) return null;
  return createElement(mod.FaceHighlightOverlay, props);
}

function OcrHighlightOverlayLazy(props: any) {
  const [mod, setMod] = useState<any>(null);
  useEffect(() => {
    import("./components/photo-overlays").then((m) => setMod(m));
  }, []);
  if (!mod) return null;
  return createElement(mod.OcrHighlightOverlay, props);
}
