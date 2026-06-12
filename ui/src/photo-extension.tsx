import type { AppRuntimeCtx, PhotoExtension } from "@tokimo/sdk";
import { PhotoAiOverlay } from "./components/PhotoAiOverlay";
import { PhotoAiInfoExtras } from "./components/PhotoAiInfoExtras";
import { PhotoAiToolbarButtons } from "./components/PhotoAiToolbarButtons";
import { withProviders } from "./shared/providers";

/**
 * Creates the PhotoExtension for the photo app.
 * Call registerExtension() on the result in mount(), save the unregister
 * function, and call it in dispose().
 */
export function createPhotoExtension(ctx: AppRuntimeCtx): PhotoExtension {
  return {
    renderImageOverlays: (photo, displayCtx) =>
      withProviders(
        <PhotoAiOverlay photo={photo} displayCtx={displayCtx} />,
        ctx,
      ),
    renderInfoPanelExtras: (photo) =>
      withProviders(
        <PhotoAiInfoExtras
          photoId={photo.id}
          appId={photo.appId ?? "photo"}
        />,
        ctx,
      ),
    renderToolbarSlot: (photo) =>
      withProviders(<PhotoAiToolbarButtons photo={photo} />, ctx),
  };
}
