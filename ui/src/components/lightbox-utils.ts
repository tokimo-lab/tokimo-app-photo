/** Pure utility functions and types for the Photo Lightbox animation system. */

export const ANIM_DURATION = 300;
export const ANIM_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";
export const FADE_IN_EASING = "cubic-bezier(0.7, 0, 0.3, 1)";
export const FADE_OUT_EASING = "cubic-bezier(0.7, 0, 0.3, 1)";

export interface FlyRect {
  top: number;
  left: number;
  width: number;
  height: number;
  /** True when the rect was clipped by an overflow:hidden ancestor (zoomed image). */
  clipped?: boolean;
}

export type AnimState = "entering" | "open" | "exiting";

export function queryElementRect(selector: string): FlyRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const raw = el.getBoundingClientRect();
  if (raw.width === 0 || raw.height === 0) return null;

  let clipped = false;
  let parent = el.parentElement;
  while (parent) {
    const ov = getComputedStyle(parent).overflow;
    if (ov === "hidden" || ov === "clip") {
      const pr = parent.getBoundingClientRect();
      if (
        raw.top < pr.top ||
        raw.left < pr.left ||
        raw.right > pr.right ||
        raw.bottom > pr.bottom
      ) {
        clipped = true;
      }
      break;
    }
    parent = parent.parentElement;
  }

  if (
    raw.bottom < 0 ||
    raw.top > window.innerHeight ||
    raw.right < 0 ||
    raw.left > window.innerWidth
  )
    return null;
  return {
    top: raw.top,
    left: raw.left,
    width: raw.width,
    height: raw.height,
    clipped,
  };
}

/** For images smaller than the available area, compute a default zoom (up to 2×)
 *  that fills the viewport without requiring drag/pan. */
export function computeInitialScale(
  photoWidth: number,
  photoHeight: number,
  infoPanelVisible: boolean,
): number {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoW = infoPanelVisible ? 320 : 0;
  const pad = 48;
  const availW = Math.max(1, vw - infoW - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const fitScale = Math.min(availW / photoWidth, availH / photoHeight);
  if (fitScale <= 1) return 1;
  return Math.min(2, fitScale);
}

/** Compute where the lightbox image will be rendered (center of available area). */
export function computeCenterRect(
  photoWidth: number,
  photoHeight: number,
  infoPanelVisible: boolean,
): FlyRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoW = infoPanelVisible ? 320 : 0;
  const pad = 48;
  const availW = Math.max(1, vw - infoW - pad * 2);
  const availH = Math.max(1, vh - pad * 2);

  const fitScale = Math.min(availW / photoWidth, availH / photoHeight);
  let w: number;
  let h: number;

  if (fitScale >= 1) {
    const s = Math.min(2, fitScale);
    w = photoWidth * s;
    h = photoHeight * s;
  } else {
    const imgAspect = photoWidth / photoHeight;
    const areaAspect = availW / availH;
    if (imgAspect > areaAspect) {
      w = availW;
      h = w / imgAspect;
    } else {
      h = availH;
      w = h * imgAspect;
    }
  }
  return {
    top: pad + (availH - h) / 2,
    left: pad + (availW - w) / 2,
    width: w,
    height: h,
  };
}

/** Compute the CSS rendered size of the img element (before transform scale). */
export function computeThumbDisplaySize(
  photoWidth: number,
  photoHeight: number,
  showInfo: boolean,
): { width: number; height: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const infoW = showInfo ? 320 : 0;
  const pad = 48;
  const availW = Math.max(1, vw - infoW - pad * 2);
  const availH = Math.max(1, vh - pad * 2);
  const fitScale = Math.min(availW / photoWidth, availH / photoHeight);
  if (fitScale >= 1) {
    return { width: photoWidth, height: photoHeight };
  }
  const imgAspect = photoWidth / photoHeight;
  if (imgAspect > availW / availH) {
    return { width: availW, height: availW / imgAspect };
  }
  return { width: availH * imgAspect, height: availH };
}
