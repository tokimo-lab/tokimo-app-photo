import type { AppRuntimeCtx } from "@tokimo/sdk";
import { PhotoAiInfoExtras } from "./components/PhotoAiInfoExtras";
import { PhotoAiOverlay } from "./components/PhotoAiOverlay";
import { PhotoAiToolbarButtons } from "./components/PhotoAiToolbarButtons";
import { PhotoExtensionProviders } from "./components/PhotoExtensionProviders";
import type {
  PhotoDisplayContext,
  PhotoExtension,
  PhotoInfo,
} from "./photo-extension-types";

export function createPhotoExtension(ctx: AppRuntimeCtx): PhotoExtension {
  return {
    renderImageOverlays(photo: PhotoInfo, displayCtx: PhotoDisplayContext) {
      return (
        <PhotoExtensionProviders ctx={ctx}>
          <PhotoAiOverlay photo={photo} displayCtx={displayCtx} />
        </PhotoExtensionProviders>
      );
    },
    renderInfoPanelExtras(photo: PhotoInfo) {
      return (
        <PhotoExtensionProviders ctx={ctx}>
          <PhotoAiInfoExtras
            photoId={photo.id}
            appId={photo.appId ?? ctx.appId}
          />
        </PhotoExtensionProviders>
      );
    },
    renderToolbarSlot(photo: PhotoInfo) {
      return (
        <PhotoExtensionProviders ctx={ctx}>
          <PhotoAiToolbarButtons photo={photo} />
        </PhotoExtensionProviders>
      );
    },
  };
}
