import libheif from "libheif-js/wasm-bundle";

type HeifImage = InstanceType<typeof libheif.HeifImage>;

/** Pick the primary (largest) image — avoids decoding gain map on iPhone HEIC. */
function findPrimaryImage(images: HeifImage[]): HeifImage {
  if (images.length === 1) return images[0];
  try {
    const primary = images.find((img) => img.is_primary());
    if (primary) return primary;
  } catch {
    // is_primary() not supported in this libheif build
  }
  let best = images[0];
  let bestPx = best.get_width() * best.get_height();
  for (let i = 1; i < images.length; i++) {
    const px = images[i].get_width() * images[i].get_height();
    if (px > bestPx) {
      best = images[i];
      bestPx = px;
    }
  }
  return best;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, buffer } = e.data as { id: number; buffer: ArrayBuffer };
  try {
    const decoder = new libheif.HeifDecoder();
    const images = decoder.decode(new Uint8Array(buffer));
    if (!images || images.length === 0) {
      self.postMessage({ id, error: "No images found in HEIC file" });
      return;
    }
    const img = findPrimaryImage(images);
    console.log(
      `[HEIC-worker] selected: ${img.get_width()}×${img.get_height()}`,
    );
    const w = img.get_width();
    const h = img.get_height();
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      self.postMessage({ id, error: "Failed to get 2d context" });
      return;
    }
    const imageData = ctx.createImageData(w, h);
    img.display(imageData, (result: ImageData | null) => {
      if (!result) {
        self.postMessage({ id, error: "HEIF decode failed" });
        return;
      }
      ctx.putImageData(result, 0, 0);
      canvas
        .convertToBlob({ type: "image/jpeg", quality: 0.92 })
        .then((blob) => self.postMessage({ id, blob }))
        .catch((err) =>
          self.postMessage({ id, error: (err as Error).message }),
        );
    });
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message });
  }
};
