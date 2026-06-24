import { Fragment, useEffect, useState } from "react";
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

function useImageRefVersion(
  imgRef: PhotoDisplayContext["imgRef"],
  resetKey: string,
) {
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    let frameId: number | undefined;
    let timeoutId: number | undefined;
    let currentImg: HTMLImageElement | null = null;
    let nextVersion = 0;
    let stopped = false;

    setVersion(null);

    const schedule = (ready: boolean) => {
      if (stopped) return;
      if (ready) {
        timeoutId = window.setTimeout(check, 100);
      } else {
        frameId = window.requestAnimationFrame(check);
      }
    };

    const check = () => {
      const img = imgRef.current;
      const ready = !!img && img.offsetWidth > 0 && img.offsetHeight > 0;

      if (ready && img !== currentImg) {
        currentImg = img;
        nextVersion += 1;
        setVersion(nextVersion);
      }

      schedule(ready);
    };

    frameId = window.requestAnimationFrame(check);

    return () => {
      stopped = true;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [imgRef, resetKey]);

  return version;
}

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
  const imgRefVersion = useImageRefVersion(displayCtx.imgRef, photo.id);

  if (!photoWidth || !photoHeight) return null;
  if (imgRefVersion == null) return null;

  const overlayKey = `${photo.id}:${imgRefVersion}`;

  return (
    <Fragment key={overlayKey}>
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
    </Fragment>
  );
}
