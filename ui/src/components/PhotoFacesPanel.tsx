import { Users } from "lucide-react";
import type { CSSProperties } from "react";
import type { PhotoFaceOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";

const THUMB_WIDTH = 800;

interface PhotoFacesPanelProps {
  photoId: string;
  photoWidth: number | null;
  photoHeight: number | null;
  hoveredFaceId: number | null;
  onHoverFace: (faceId: number | null) => void;
}

export function PhotoFacesPanel({
  photoId,
  photoWidth,
  photoHeight,
  hoveredFaceId,
  onHoverFace,
}: PhotoFacesPanelProps) {
  const { data: faces } = api.photoSettings.getPhotoFaces.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

  if (!faces || faces.length === 0) return null;

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
        <Users className="h-3 w-3" />
        人物
      </div>
      <div className="flex flex-wrap gap-3">
        {faces.map((face) => (
          <FaceChip
            key={face.id}
            face={face}
            photoId={photoId}
            photoWidth={photoWidth}
            photoHeight={photoHeight}
            isHovered={hoveredFaceId === face.id}
            onHover={onHoverFace}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compute background-image CSS to crop a face from the photo thumbnail.
 * Face coordinates are in original-image pixels; the thumbnail is THUMB_WIDTH wide.
 */
function computeFaceBgStyle(
  face: PhotoFaceOutput,
  photoWidth: number,
  photoHeight: number,
  chipSize: number,
  thumbnailSrc: string,
): CSSProperties {
  // Scale face coords from original resolution → thumbnail resolution
  const s = THUMB_WIDTH / photoWidth;
  const thumbHeight = photoHeight * s;
  const fx = face.x * s;
  const fy = face.y * s;
  const fw = face.w * s;
  const fh = face.h * s;

  // Square crop region centered on face, with padding
  const pad = Math.max(fw, fh) * 0.35;
  const cropSize = Math.max(fw, fh) + pad * 2;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const half = cropSize / 2;
  const cropLeft = Math.max(0, Math.min(cx - half, THUMB_WIDTH - cropSize));
  const cropTop = Math.max(0, Math.min(cy - half, thumbHeight - cropSize));

  // Zoom so that cropSize → chipSize
  const zoom = chipSize / cropSize;

  return {
    backgroundImage: `url(${thumbnailSrc})`,
    backgroundSize: `${THUMB_WIDTH * zoom}px ${thumbHeight * zoom}px`,
    backgroundPosition: `${-cropLeft * zoom}px ${-cropTop * zoom}px`,
    backgroundRepeat: "no-repeat",
  };
}

function FaceChip({
  face,
  photoId,
  photoWidth,
  photoHeight,
  isHovered,
  onHover,
}: {
  face: PhotoFaceOutput;
  photoId: string;
  photoWidth: number | null;
  photoHeight: number | null;
  isHovered: boolean;
  onHover: (faceId: number | null) => void;
}) {
  const chipSize = 56;
  const thumbnailSrc = `/api/photos/${photoId}/thumbnail?w=${THUMB_WIDTH}`;
  const canCrop = photoWidth != null && photoHeight != null && photoWidth > 0;

  const bgStyle = canCrop
    ? computeFaceBgStyle(face, photoWidth, photoHeight, chipSize, thumbnailSrc)
    : undefined;

  return (
    <button
      type="button"
      className="flex w-16 cursor-pointer flex-col items-center gap-1 bg-transparent"
      onMouseEnter={() => onHover(face.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Circular face avatar */}
      <div
        className={`h-14 w-14 overflow-hidden rounded-full border-2 transition-all ${
          isHovered
            ? "border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"
            : "border-white/20 hover:border-white/40"
        }`}
      >
        {bgStyle ? (
          <div
            className="h-full w-full"
            style={bgStyle}
            role="img"
            aria-label={face.personName ?? "未命名"}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/10 text-white/30">
            <Users className="h-6 w-6" />
          </div>
        )}
      </div>

      {/* Person name */}
      <span
        className={`max-w-full truncate text-center text-[11px] leading-tight ${
          isHovered ? "text-blue-400" : "text-white/60"
        }`}
        title={face.personName ?? undefined}
      >
        {face.personName || "未命名"}
      </span>
    </button>
  );
}
