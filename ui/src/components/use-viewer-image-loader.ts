import { useEffect, useRef, useState } from "react";
import { convertHeicToJpegOffThread } from "@/shared/utils/heic-decoder";
import { extractRawPreview, isRawFile } from "@/shared/utils/raw-decoder";

interface ViewerImageLoaderOptions {
  photoId: string;
  filename: string | undefined;
}

export function useViewerImageLoader({
  photoId,
  filename,
}: ViewerImageLoaderOptions) {
  const fullUrl = `/api/apps/photo/item/${photoId}/image`;
  const [fullBlobUrl, setFullBlobUrl] = useState<string | null>(null);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullDecoded, setFullDecoded] = useState(false);
  const [thumbFadeOut, setThumbFadeOut] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [decoding, setDecoding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const show = () => setMounted(true);
    window.addEventListener("photo-fly-end", show);
    const fallback = setTimeout(show, 400);
    return () => {
      window.removeEventListener("photo-fly-end", show);
      clearTimeout(fallback);
    };
  }, []);

  // Delay thumbnail fade-out so full-res has time to paint first
  useEffect(() => {
    if (!fullDecoded) {
      setThumbFadeOut(false);
      return;
    }
    const timer = setTimeout(() => setThumbFadeOut(true), 50);
    return () => clearTimeout(timer);
  }, [fullDecoded]);

  const isHeic = /\.heic$/i.test(filename ?? "");
  const isRaw = isRawFile(filename);

  useEffect(() => {
    if (!mounted || fullLoaded) return;
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        const res = await fetch(fullUrl, { signal: abort.signal });
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

        // RAW files — extract embedded JPEG preview via WASM
        if (isRaw) {
          setDecoding(true);
          const jpegBlob = await extractRawPreview(blob);
          if (abort.signal.aborted) return;
          if (jpegBlob) {
            setFullBlobUrl(URL.createObjectURL(jpegBlob));
            setLoadProgress(1);
            setDecoding(false);
            setFullLoaded(true);
            return;
          }
          setDecoding(false);
        }

        const url = URL.createObjectURL(blob);
        setDecoding(true);
        const testImg = new Image();
        testImg.src = url;
        try {
          await testImg.decode();
          setFullBlobUrl(url);
        } catch {
          URL.revokeObjectURL(url);
          const blobIsHeic =
            blob.type === "image/heic" || blob.type === "image/heif" || isHeic;
          if (blobIsHeic) {
            const jpegBlob = await convertHeicToJpegOffThread(blob);
            if (abort.signal.aborted) return;
            setFullBlobUrl(URL.createObjectURL(jpegBlob));
          } else {
            const jpegRes = await fetch(`${fullUrl}?format=jpeg`, {
              signal: abort.signal,
            });
            const jpegBlob = await jpegRes.blob();
            if (abort.signal.aborted) return;
            setFullBlobUrl(URL.createObjectURL(jpegBlob));
          }
        }
        setLoadProgress(1);
        setDecoding(false);
        setFullLoaded(true);
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error("[PhotoWindowViewer] Failed to load image:", err);
          setLoadProgress(0);
          setDecoding(false);
        }
      }
    })();

    return () => {
      abort.abort();
      abortRef.current = null;
    };
  }, [fullUrl, fullLoaded, mounted, isHeic, isRaw]);

  // Clean up blob URL on unmount
  useEffect(() => {
    const url = fullBlobUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [fullBlobUrl]);

  const resetImage = () => {
    if (fullBlobUrl) URL.revokeObjectURL(fullBlobUrl);
    setFullBlobUrl(null);
    setFullLoaded(false);
    setFullDecoded(false);
    setLoadProgress(0);
  };

  return {
    fullBlobUrl,
    fullLoaded,
    fullDecoded,
    setFullDecoded,
    thumbFadeOut,
    loadProgress,
    decoding,
    mounted,
    resetImage,
  };
}
