import type { PhotoDisplayContext, PhotoInfo } from "@tokimo/sdk";
import { api } from "@/generated/rust-api";
import {
  FaceHighlightOverlay,
  OcrBboxEditOverlay,
  OcrBlockSelectLayer,
  OcrHighlightOverlay,
} from "./photo-overlays";
import { usePhotoAiState, setPendingBbox, setOcrSelectionRanges } from "./PhotoAiStore";

export function PhotoAiOverlay({
  photo,
  displayCtx,
}: {
  photo: PhotoInfo;
  displayCtx: PhotoDisplayContext;
}) {
  const { hoveredFaceId, hoveredOcrId, editingOcrId, pendingBbox } =
    usePhotoAiState(photo.id);

  const { data: faces } = api.photo.getPhotoFaces.useQuery(
    { photoId: photo.id },
    { enabled: !!photo.id },
  );

  const { data: ocrResults } = api.photo.getPhotoOcrResults.useQuery(
    { photoId: photo.id },
    { enabled: !!photo.id },
  );

  const photoWidth = photo.width ?? displayCtx.naturalWidth;
  const photoHeight = photo.height ?? displayCtx.naturalHeight;

  return (
    <>
      {/* OCR block text selection layer — disabled during bbox editing to avoid click conflicts */}
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
          orientation={photo.orientation}
        />
      )}

      {/* Face highlight on hover */}
      {faces && faces.length > 0 && hoveredFaceId != null && (
        <FaceHighlightOverlay
          faces={faces}
          hoveredFaceId={hoveredFaceId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          orientation={photo.orientation}
        />
      )}

      {/* OCR highlight on hover */}
      {ocrResults && ocrResults.length > 0 && hoveredOcrId != null && (
        <OcrHighlightOverlay
          ocrResults={ocrResults}
          hoveredOcrId={hoveredOcrId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          orientation={photo.orientation}
        />
      )}

      {/* OCR bbox edit overlay */}
      {ocrResults && editingOcrId != null && (
        <OcrBboxEditOverlay
          ocrResults={ocrResults}
          editingOcrId={editingOcrId}
          photoWidth={photoWidth}
          photoHeight={photoHeight}
          imgRef={displayCtx.imgRef}
          onBboxChange={(bbox) => setPendingBbox(photo.id, bbox)}
          orientation={photo.orientation}
        />
      )}
    </>
  );
}
