import { Users } from "lucide-react";
import type { CSSProperties } from "react";
import type { PhotoFaceOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";

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

/** Compute CSS styles to show a face crop from the photo thumbnail */
function computeFaceCropStyle(
  face: PhotoFaceOutput,
  photoWidth: number,
  photoHeight: number,
  chipSize: number,
): CSSProperties {
  // Add padding around the face for a nicer crop
  const pad = Math.max(face.w, face.h) * 0.3;
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const cropSize = Math.max(face.w, face.h) + pad * 2;

  // Clamp to image bounds
  const half = cropSize / 2;
  const left = Math.max(0, Math.min(cx - half, photoWidth - cropSize));
  const top = Math.max(0, Math.min(cy - half, photoHeight - cropSize));

  // Scale: how much to scale the image so the crop fills chipSize
  const scale = chipSize / cropSize;

  return {
    width: photoWidth * scale,
    height: photoHeight * scale,
    objectFit: "none" as const,
    objectPosition: `${-left * scale}px ${-top * scale}px`,
    transform: `scale(1)`,
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
  const chipSize = 56; // 14 * 4 = h-14 w-14
  const thumbnailSrc = `/api/photos/${photoId}/thumbnail?w=800`;
  const canCrop = photoWidth != null && photoHeight != null && photoWidth > 0;

  const cropStyle = canCrop
    ? computeFaceCropStyle(face, photoWidth, photoHeight, chipSize)
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
        {cropStyle ? (
          <img
            src={thumbnailSrc}
            alt={face.personName ?? "未命名"}
            style={cropStyle}
            draggable={false}
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
