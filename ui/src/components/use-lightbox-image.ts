import { apiFetchBlob } from "@/api/client";
import { useEffect, useRef, useState } from "react";
import { convertHeicToJpegOffThread } from "@/shared/utils/heic-decoder";
import type { AnimState } from "./lightbox-utils";

interface UseLightboxImageOptions {
  photoId: string;
  fullSrc: string | undefined;
  animState: AnimState;
}

export function useLightboxImage({
  photoId,
  fullSrc,
  animState,
}: UseLightboxImageOptions) {
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [fullDecoded, setFullDecoded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const prevPhotoId = useRef(photoId);
  const abortRef = useRef<AbortController | null>(null);

  // Reset state when navigating to a different photo
  if (prevPhotoId.current !== photoId) {
    prevPhotoId.current = photoId;
    setFullLoaded(false);
    setFullDecoded(false);
    setLoadProgress(0);
    setDecoding(false);
    if (fullBlobUrl) {
      URL.revokeObjectURL(fullBlobUrl);
      setFullBlobUrl(null);
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  // Don't start loading full-res until enter animation finishes
  const shouldLoadFull = animState !== "entering";

  // Fetch full-res image with real progress tracking
  useEffect(() => {
    if (!shouldLoadFull || fullLoaded || !fullSrc) return;

    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await apiFetchBlob(fullSrc, { signal: abort.signal });
        const contentLength = res.headers.get("Content-Length");
        const total = contentLength ? Number.parseInt(contentLength, 10) : 0;

        let blob: Blob;

        if (!res.body) {
          blob = await res.blob();
          if (abort.signal.aborted) return;
        } else {
          const reader = res.body.getReader();
          const chunks: BlobPart[] = [];
          let received = 0;

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (total > 0) {
              setLoadProgress(Math.min(received / total, 1));
            } else {
              setLoadProgress(Math.min(received / (received + 200_000), 0.95));
            }
          }

          if (abort.signal.aborted) return;

          blob = new Blob(chunks, {
            type: res.headers.get("Content-Type") || "image/jpeg",
          });
        }

        const url = URL.createObjectURL(blob);

        setDecoding(true);
        const testImg = new Image();
        testImg.src = url;
        try {
          await testImg.decode();
          setFullBlobUrl(url);
          setLoadProgress(1);
          setDecoding(false);
          setFullLoaded(true);
        } catch {
          URL.revokeObjectURL(url);
          try {
            const jpegBlob = await convertHeicToJpegOffThread(blob);
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
            setLoadProgress(1);
            setDecoding(false);
            setFullLoaded(true);
          } catch {
            const jpegRes = await apiFetchBlob(`${fullSrc}?format=jpeg`, {
              signal: abort.signal,
            });
            const jpegBlob = await jpegRes.blob();
            if (abort.signal.aborted) return;
            const jpegUrl = URL.createObjectURL(jpegBlob);
            setFullBlobUrl(jpegUrl);
            setLoadProgress(1);
            setDecoding(false);
            setFullLoaded(true);
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[PhotoLightbox] Failed to load image:", err);
          setLoadProgress(0);
          setDecoding(false);
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [shouldLoadFull, fullLoaded, fullSrc]);

  // Clean up blob URL on unmount
  useEffect(() => {
    const url = fullBlobUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [fullBlobUrl]);

  return {
    fullLoaded,
    fullBlobUrl,
    fullDecoded,
    setFullDecoded,
    loadProgress,
    decoding,
    shouldLoadFull,
  };
}
