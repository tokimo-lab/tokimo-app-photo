import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoOutput } from "@/generated/rust-types";
import {
  ANIM_DURATION,
  type AnimState,
  computeCenterRect,
  type FlyRect,
  queryElementRect,
} from "./lightbox-utils";
import { getDisplayDimensions } from "./photo-utils";

interface UseLightboxFlyOptions {
  photo: PhotoOutput;
  showInfo: boolean;
  detail: { width?: number | null; height?: number | null } | undefined;
  thumbSrc: string | undefined;
  animSourceSelector?: string;
  onClose: () => void;
}

export function useLightboxFly({
  photo,
  showInfo,
  detail,
  thumbSrc,
  animSourceSelector,
  onClose,
}: UseLightboxFlyOptions) {
  const photoDims = getDisplayDimensions(photo);

  const [animState, setAnimState] = useState<AnimState>(() => {
    if (!photo.sourceId || !photoDims) return "open";
    return "entering";
  });
  const [flyRect, setFlyRect] = useState<FlyRect | null>(null);
  const [flyTransition, setFlyTransition] = useState(false);
  const sourceClippedRef = useRef(false);

  // Enter animation (mount-only)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
  useEffect(() => {
    if (animState !== "entering") return;

    const thumbRect = queryElementRect(
      animSourceSelector ?? `[data-photo-id="${photo.id}"]`,
    );
    if (!thumbRect || !photoDims) {
      setAnimState("open");
      return;
    }

    sourceClippedRef.current = thumbRect.clipped ?? false;

    const target = computeCenterRect(
      photoDims.width,
      photoDims.height,
      showInfo,
    );

    setFlyRect(thumbRect);
    setFlyTransition(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlyRect(target);
        setFlyTransition(true);
      });
    });

    const timer = setTimeout(() => {
      setAnimState("open");
      setFlyRect(null);
      setFlyTransition(false);
    }, ANIM_DURATION + 50);

    return () => clearTimeout(timer);
  }, []);

  // Close with animation
  const handleAnimatedClose = useCallback(() => {
    if (animState === "exiting") return;

    const thumbRect = queryElementRect(
      animSourceSelector ?? `[data-photo-id="${photo.id}"]`,
    );
    const infoVisible = showInfo && detail != null;

    if (thumbRect && photoDims && thumbSrc) {
      sourceClippedRef.current = thumbRect.clipped ?? false;
      const current = computeCenterRect(
        photoDims.width,
        photoDims.height,
        infoVisible,
      );

      setAnimState("exiting");
      setFlyRect(current);
      setFlyTransition(false);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlyRect(thumbRect);
          setFlyTransition(true);
        });
      });

      setTimeout(() => onClose(), ANIM_DURATION + 50);
    } else {
      setAnimState("exiting");
      setTimeout(() => onClose(), ANIM_DURATION + 50);
    }
  }, [
    animState,
    photo,
    photoDims,
    showInfo,
    detail,
    thumbSrc,
    onClose,
    animSourceSelector,
  ]);

  return {
    animState,
    flyRect,
    flyTransition,
    sourceClippedRef,
    handleAnimatedClose,
  };
}
