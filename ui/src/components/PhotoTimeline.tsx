import { useMemo, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { PhotoLightbox } from "./PhotoLightbox";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { groupPhotosByDate } from "./photo-utils";

export function PhotoTimeline({
  photos,
  onToggleFavorite,
}: {
  photos: PhotoOutput[];
  onToggleFavorite?: (photo: PhotoOutput) => void;
}) {
  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoOutput | null>(null);

  return (
    <>
      <div className="space-y-6">
        {groups.map((group) => (
          <div
            key={group.date}
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "auto 200px",
            }}
          >
            {/* Date header */}
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 py-1">
              <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                {group.label}
              </h3>
              <span className="text-xs text-neutral-400">
                {group.photos.length} 张
              </span>
            </div>

            {/* Photo grid */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
              {group.photos.map((photo) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  onClick={setSelectedPhoto}
                  onToggleFavorite={onToggleFavorite}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          allPhotos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={setSelectedPhoto}
          onToggleFavorite={onToggleFavorite}
        />
      )}
    </>
  );
}
