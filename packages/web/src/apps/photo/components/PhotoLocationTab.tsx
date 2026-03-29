import { Spin } from "@tokiomo/components";
import { ChevronLeft, MapPin } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import type { MapClusterSelection } from "./PhotoMapView";
import { PhotoMapView } from "./PhotoMapView";
import { PhotoTimeline } from "./PhotoTimeline";
import { PAGE_SIZE } from "./photo-utils";

interface PhotoLocationTabProps {
  appId: string | undefined;
  onToggleFavorite: (photo: PhotoOutput) => void;
  isSelecting: boolean;
  selectedIds: Set<string>;
  onSelect: (photo: PhotoOutput) => void;
  targetRowHeight: number;
}

type ViewLevel = "map" | "timeline";

interface ViewState {
  level: ViewLevel;
  selection?: MapClusterSelection;
}

export function PhotoLocationTab({
  appId,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
  targetRowHeight,
}: PhotoLocationTabProps) {
  const [view, setView] = useState<ViewState>({ level: "map" });
  const [photosPage, setPhotosPage] = useState(1);
  const photosAccumRef = useRef<PhotoOutput[]>([]);

  // Query photos by bounding box when in timeline view
  const bbox = view.selection?.bbox;
  const photosQuery = api.app.getPhotosByBbox.useQuery(
    {
      appId: appId!,
      minLat: bbox?.minLat ?? 0,
      maxLat: bbox?.maxLat ?? 0,
      minLng: bbox?.minLng ?? 0,
      maxLng: bbox?.maxLng ?? 0,
      page: photosPage,
      pageSize: PAGE_SIZE,
    },
    { enabled: !!appId && view.level === "timeline" && !!bbox },
  );

  // Accumulate paginated photos
  const allPhotos = useMemo(() => {
    if (!photosQuery.data) return photosAccumRef.current;
    const d = photosQuery.data as {
      items: PhotoOutput[];
      total: number;
      page: number;
    };
    if (d.page === 1) {
      photosAccumRef.current = d.items;
    } else {
      const existingIds = new Set(photosAccumRef.current.map((p) => p.id));
      const newItems = d.items.filter((p) => !existingIds.has(p.id));
      photosAccumRef.current = [...photosAccumRef.current, ...newItems];
    }
    return photosAccumRef.current;
  }, [photosQuery.data]);

  const photosTotal = (photosQuery.data as { total: number })?.total ?? 0;
  const photosHasMore = allPhotos.length < photosTotal;

  const handleClusterClick = useCallback((selection: MapClusterSelection) => {
    photosAccumRef.current = [];
    setPhotosPage(1);
    setView({ level: "timeline", selection });
  }, []);

  const handleBack = useCallback(() => {
    setView({ level: "map" });
  }, []);

  const loadMore = useCallback(() => {
    setPhotosPage((p) => p + 1);
  }, []);

  if (view.level === "map") {
    return <PhotoMapView appId={appId} onClusterClick={handleClusterClick} />;
  }

  const sel = view.selection!;

  return (
    <div className="flex flex-col gap-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-4 text-sm">
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-blue-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
          onClick={handleBack}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          全部地点
        </button>
        <span className="text-neutral-400 dark:text-neutral-500">/</span>
        <span className="flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-200">
          <MapPin className="h-3.5 w-3.5" />
          {sel.label}
        </span>
        <span className="text-neutral-400 dark:text-neutral-500">
          {photosTotal > 0 ? `${photosTotal} 张照片` : `约 ${sel.count} 张照片`}
        </span>
      </div>

      {/* Timeline */}
      {allPhotos.length > 0 ? (
        <PhotoTimeline
          photos={allPhotos}
          appId={appId!}
          total={photosTotal}
          hasMore={photosHasMore}
          onLoadMore={loadMore}
          isLoadingMore={photosQuery.isFetching && photosPage > 1}
          onToggleFavorite={onToggleFavorite}
          isSelecting={isSelecting}
          selectedIds={selectedIds}
          onSelect={onSelect}
          targetRowHeight={targetRowHeight}
        />
      ) : photosQuery.isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Spin />
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center text-neutral-400">
          该区域暂无照片
        </div>
      )}
    </div>
  );
}
