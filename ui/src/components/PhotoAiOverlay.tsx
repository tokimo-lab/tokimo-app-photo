import { api } from "../generated/rust-api";
import type { PhotoDisplayContext, PhotoInfo } from "../photo-extension-types";
import { OcrBboxEditOverlay } from "./OcrBboxEditOverlay";
import { OcrBlockSelectLayer } from "./OcrBlockSelectLayer";
import {
  setOcrSelectionRanges,
  setPendingBbox,
  usePhotoAiState,
} from "./PhotoAiStore";
import {
  FaceHighlightOverlay,
  OcrHighlightOverlay,
} from "./photo-overlays";

export function PhotoAiOverlay({
  photo,
  displayCtx,
}: {
  photo: PhotoInfo;
  displayCtx: PhotoDisplayContext;
}) {
  const { hoveredFaceId, hoveredOcrId, editingOcrId } = usePhotoAiState(
    photo.id,
  );

  const { data: detail } = api.photo.getPhoto.useQuery(
    { photoId: photo.id },
    { enabled: !!photo.id },
  );

  const { data: faces } = api.photo.getPhotoFaces.useQuery(
    { photoId: photo.id },
    { enabled: !!photo.id },
  );

  const { data: ocrResults } = api.photo.getPhotoOcrResults.useQuery(
    { photoId: photo.id },
    { enabled: !!photo.id },
  );

  const photoWidth = detail?.width ?? photo.width ?? displayCtx.naturalWidth;
  const photoHeight = detail?.height ?? photo.height ?? displayCtx.naturalHeight;
  const orientation = detail?.orientation ?? photo.orientation;

  if (!photoWidth || !photoHeight) return null;

  return (
    <>
      {ocrResults && ocrResults.length > 0 && editingOcrId == null && (
        <OcrBlockSelectLayer
          ocrResults={ocrResults}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          isZoomed={displayCtx.zoom > 1}
          onSelectionRanges={(ranges) =>
            setOcrSelectionRanges(photo.id, ranges)
          }
          orientation={orientation}
        />
      )}

      {faces && faces.length > 0 && hoveredFaceId != null && (
        <FaceHighlightOverlay
          faces={faces}
          hoveredFaceId={hoveredFaceId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          orientation={orientation}
        />
      )}

      {ocrResults && ocrResults.length > 0 && hoveredOcrId != null && (
        <OcrHighlightOverlay
          ocrResults={ocrResults}
          hoveredOcrId={hoveredOcrId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          orientation={orientation}
        />
      )}

      {ocrResults && ocrResults.length > 0 && editingOcrId != null && (
        <OcrBboxEditOverlay
          ocrResults={ocrResults}
          editingOcrId={editingOcrId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          onBboxChange={(bbox) => setPendingBbox(photo.id, bbox)}
          orientation={orientation}
        />
      )}
    </>
  );
}
