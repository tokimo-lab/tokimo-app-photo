import { Button, Empty, Spin } from "@tokiomo/components";
import { ChevronRight, MapPin, Navigation } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { useWindowNav } from "@/system";
import { PhotoTimeline } from "./PhotoTimeline";
import { PAGE_SIZE } from "./photo-utils";

interface LocationGroup {
  province: string | null;
  city: string | null;
  district: string | null;
  photoCount: number;
}

/** Drill-down hierarchy: province → city → district → photos */
type DrillLevel = "province" | "city" | "district" | "photos";

interface DrillState {
  level: DrillLevel;
  province?: string;
  city?: string;
  district?: string;
}

interface PhotoLocationsViewProps {
  appId: string | undefined;
  onToggleFavorite: (photo: PhotoOutput) => void;
  isSelecting: boolean;
  selectedIds: Set<string>;
  onSelect: (photo: PhotoOutput) => void;
  targetRowHeight: number;
}

export function PhotoLocationsView({
  appId,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
  targetRowHeight,
}: PhotoLocationsViewProps) {
  const [drill, setDrill] = useState<DrillState>({ level: "province" });
  const [photosPage, setPhotosPage] = useState(1);
  const photosAccumRef = useRef<PhotoOutput[]>([]);
  const { openWindow } = useWindowNav();

  const statsQuery = api.app.getLocationStats.useQuery(
    { appId: appId! },
    { enabled: !!appId },
  );

  const photosQuery = api.app.getPhotosByLocation.useQuery(
    {
      appId: appId!,
      province: drill.province,
      city: drill.city,
      district: drill.district,
      page: photosPage,
      pageSize: PAGE_SIZE,
    },
    { enabled: !!appId && drill.level === "photos" },
  );

  // Group stats by current drill level
  const groups = useMemo<LocationGroup[]>(() => {
    if (!statsQuery.data) return [];
    const data = statsQuery.data as LocationGroup[];

    if (drill.level === "province") {
      const map = new Map<string, number>();
      for (const g of data) {
        const key = g.province || "未知";
        map.set(key, (map.get(key) || 0) + g.photoCount);
      }
      return Array.from(map.entries())
        .map(([province, count]) => ({
          province,
          city: null,
          district: null,
          photoCount: count,
        }))
        .sort((a, b) => b.photoCount - a.photoCount);
    }

    if (drill.level === "city") {
      const map = new Map<string, number>();
      for (const g of data) {
        if (g.province !== drill.province) continue;
        const key = g.city || "未知";
        map.set(key, (map.get(key) || 0) + g.photoCount);
      }
      return Array.from(map.entries())
        .map(([city, count]) => ({
          province: drill.province ?? null,
          city,
          district: null,
          photoCount: count,
        }))
        .sort((a, b) => b.photoCount - a.photoCount);
    }

    if (drill.level === "district") {
      return data
        .filter((g) => g.province === drill.province && g.city === drill.city)
        .sort((a, b) => b.photoCount - a.photoCount);
    }

    return [];
  }, [statsQuery.data, drill]);

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

  const handleDrill = useCallback(
    (group: LocationGroup) => {
      if (drill.level === "province") {
        setDrill({
          level: "city",
          province: group.province ?? undefined,
        });
      } else if (drill.level === "city") {
        setDrill({
          level: "district",
          province: drill.province,
          city: group.city ?? undefined,
        });
      } else if (drill.level === "district") {
        photosAccumRef.current = [];
        setPhotosPage(1);
        setDrill({
          level: "photos",
          province: drill.province,
          city: drill.city,
          district: group.district ?? undefined,
        });
      }
    },
    [drill],
  );

  const handleBack = useCallback(() => {
    if (drill.level === "photos") {
      setDrill({
        level: "district",
        province: drill.province,
        city: drill.city,
      });
    } else if (drill.level === "district") {
      setDrill({ level: "city", province: drill.province });
    } else if (drill.level === "city") {
      setDrill({ level: "province" });
    }
  }, [drill]);

  const loadMore = useCallback(() => {
    setPhotosPage((p) => p + 1);
  }, []);

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      {
        label: "全部地点",
        onClick:
          drill.level !== "province"
            ? () => setDrill({ level: "province" })
            : undefined,
      },
    ];
    if (drill.province && drill.level !== "province") {
      items.push({
        label: drill.province,
        onClick:
          drill.level !== "city"
            ? () => setDrill({ level: "city", province: drill.province })
            : undefined,
      });
    }
    if (drill.city && drill.level !== "city" && drill.level !== "province") {
      items.push({
        label: drill.city,
        onClick:
          drill.level !== "district"
            ? () =>
                setDrill({
                  level: "district",
                  province: drill.province,
                  city: drill.city,
                })
            : undefined,
      });
    }
    if (drill.district && drill.level === "photos") {
      items.push({ label: drill.district });
    }
    return items;
  }, [drill]);

  if (statsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin />
      </div>
    );
  }

  const totalGeoPhotos =
    (statsQuery.data as LocationGroup[])?.reduce(
      (s, g) => s + g.photoCount,
      0,
    ) ?? 0;

  if (totalGeoPhotos === 0) {
    return (
      <Empty
        description={
          <span>
            暂无地理位置数据。请先
            <button
              type="button"
              className="text-[var(--accent-text)] hover:underline"
              onClick={() =>
                openWindow({
                  type: "system",
                  title: "Settings",
                  metadata: { pageId: "external-database" },
                })
              }
            >
              配置高德 API 密钥
            </button>
            并触发逆地理编码。
          </span>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 text-sm">
        {breadcrumb.map((item, i) => (
          <span key={item.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />}
            {item.onClick ? (
              <button
                type="button"
                className="cursor-pointer text-blue-500 hover:text-blue-600 hover:underline dark:text-blue-400"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <span className="font-medium text-neutral-700 dark:text-neutral-200">
                {item.label}
              </span>
            )}
          </span>
        ))}
        <span className="ml-2 text-neutral-400 dark:text-neutral-500">
          {drill.level === "photos"
            ? `${photosTotal} 张照片`
            : `${totalGeoPhotos} 张照片已标注地理位置`}
        </span>
      </div>

      {/* Location groups grid */}
      {drill.level !== "photos" && (
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {groups.map((g) => {
            const label =
              drill.level === "province"
                ? g.province
                : drill.level === "city"
                  ? g.city
                  : g.district;
            return (
              <button
                type="button"
                key={`${g.province}-${g.city}-${g.district}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-750"
                onClick={() => handleDrill(g)}
              >
                <MapPin className="h-5 w-5 shrink-0 text-blue-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {label || "未知"}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {g.photoCount} 张照片
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
              </button>
            );
          })}
        </div>
      )}

      {/* Photos view */}
      {drill.level === "photos" && (
        <>
          <div className="px-4">
            <Button
              variant="text"
              onClick={handleBack}
              className="mb-2 text-sm"
            >
              <Navigation className="mr-1 h-3.5 w-3.5" />
              返回上级
            </Button>
          </div>
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
            <div className="flex h-32 items-center justify-center">
              <Spin />
            </div>
          ) : (
            <Empty description="该地点暂无照片" />
          )}
        </>
      )}
    </div>
  );
}
