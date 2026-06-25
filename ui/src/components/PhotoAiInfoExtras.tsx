import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  MapPin,
  Plus,
  ScanText,
  Search,
  SearchCode,
  Sparkles,
  Tag,
} from "lucide-react";
import { type ComponentType, useCallback } from "react";
import { type PhotoOcrResultItem, api } from "../generated/rust-api";
import { getOcrModelName } from "../lib/ocr-models";
import { thumbUrl } from "../lib/thumb";
import { useRuntimeCtx, type TaskMetadata } from "@tokimo/sdk";
import type { OcrDebugWindowMetadata } from "./OcrDebugWindow";
import { OcrResultRow } from "./OcrResultRow";
import {
  setEditingOcrId,
  setHoveredFaceId,
  setHoveredOcrId,
  usePhotoAiState,
} from "./PhotoAiStore";
import { PhotoFacesPanel } from "./PhotoFacesPanel";
import { PhotoMiniMap } from "./PhotoMiniMap";
import { InfoRow, InfoSection } from "./info-panel-helpers";

export function PhotoAiInfoExtras({
  photoId,
  appId,
}: {
  photoId: string;
  appId: string;
}) {
  const { shell } = useRuntimeCtx();
  const queryClient = useQueryClient();
  const aiState = usePhotoAiState(photoId);

  const detailQuery = api.photo.getPhoto.useQuery(
    { photoId },
    { enabled: !!photoId },
  );
  const detail = detailQuery.data;

  const { data: ocrResults } = api.photo.getPhotoOcrResults.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

  const { data: similarData } = api.photo.similarPhotos.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

  const { data: tagsData } = api.photo.photoTags.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

  const createOcrMut = api.photo.createOcrResult.useMutation();

  const invalidateAll = useCallback(() => {
    api.photo.getPhoto.invalidate(queryClient, { photoId });
    api.photo.getPhotoFaces.invalidate(queryClient, { photoId });
    api.photo.getPhotoOcrResults.invalidate(queryClient, { photoId });
    void detailQuery.refetch();
  }, [detailQuery, photoId, queryClient]);

  const openPhotoLibraryWindow = useCallback(
    (
      libraryId: string,
      title: string,
      metadata: Record<string, unknown>,
    ) => {
      shell.windowManager.openWindow({
        type: "photo",
        appId: libraryId,
        title,
        route: `/library/${libraryId}`,
        metadata: {
          appId: libraryId,
          ...metadata,
        },
        forceNew: true,
      });
    },
    [shell.windowManager],
  );

  const handleViewNearby = useCallback(
    (selection: import("./PhotoMapView").MapClusterSelection) => {
      openPhotoLibraryWindow(appId, selection.label, {
        tab: "locations",
        locationBbox: selection,
      });
    },
    [appId, openPhotoLibraryWindow],
  );

  const handleNavigateToPerson = useCallback(
    (personId: string) => {
      openPhotoLibraryWindow(appId, "人物", {
        tab: "people",
        personId,
      });
    },
    [appId, openPhotoLibraryWindow],
  );

  const handleAddOcr = useCallback(() => {
    if (!detail) return;
    const pw = detail.width || 1000;
    const ph = detail.height || 1000;
    const w = Math.round(pw * 0.2);
    const h = Math.round(ph * 0.04);
    const x = Math.round((pw - w) / 2);
    const y = Math.round((ph - h) / 2);
    createOcrMut.mutate(
      { photoId: detail.id, text: "", x, y, w, h },
      {
        onSuccess: (result) => {
          api.photo.getPhotoOcrResults.invalidate(queryClient, {
            photoId: detail.id,
          });
          setEditingOcrId(detail.id, result.id);
        },
      },
    );
  }, [createOcrMut, detail, queryClient]);

  if (!detail) return null;

  return (
    <div className="space-y-4">
      <PhotoFacesPanel
        photoId={detail.id}
        appId={detail.appId}
        photoWidth={detail.width}
        photoHeight={detail.height}
        hoveredFaceId={aiState.hoveredFaceId}
        onHoverFace={(id) => setHoveredFaceId(photoId, id)}
        onNavigateToPerson={handleNavigateToPerson}
      />

      {similarData?.indexed && similarData.items.length > 0 && (
        <InfoSection
          icon={<Search className="h-3 w-3" />}
          title="相似照片"
          actions={
            <button
              type="button"
              onClick={() => {
                openPhotoLibraryWindow(detail.appId, "相似照片", {
                  tab: "timeline",
                  similarSourceId: detail.id,
                });
              }}
              className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/70"
            >
              更多
              <ChevronRight className="h-3 w-3" />
            </button>
          }
        >
          <div className="grid grid-cols-3 gap-1.5">
            {similarData.items.map((item) => (
              <button
                type="button"
                key={item.photoId}
                className="group relative aspect-square overflow-hidden rounded cursor-pointer"
                onClick={() => {
                  shell.windowManager.openWindow({
                    type: "image",
                    title: item.filename,
                    route: `/photos/${item.photoId}`,
                    appId: detail.appId,
                    sourceType: "photo",
                    sourceId: item.photoId,
                  });
                }}
              >
                <img
                  src={thumbUrl("photo", item.photoId, 160)}
                  alt={item.filename}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-1 pb-0.5 pt-3 text-right">
                  <span className="text-[10px] font-medium text-white/80 tabular-nums">
                    {Math.round(item.similarity * 100)}%
                  </span>
                </div>
              </button>
            ))}
          </div>
        </InfoSection>
      )}

      {tagsData?.indexed && tagsData.tags.length > 0 && (
        <InfoSection icon={<Tag className="h-3 w-3" />} title="智能标签">
          <div className="flex flex-wrap gap-1.5">
            {tagsData.tags.map((tag) => (
              <button
                type="button"
                key={`${tag.category}-${tag.subcategory}`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                title={`${tag.category} · ${tag.subcategory} (${Math.round(tag.score * 100)}%)`}
                onClick={() => {
                  openPhotoLibraryWindow(
                    detail.appId,
                    `${tag.icon} ${tag.subcategory}`,
                    {
                      tab: "timeline",
                      tagFilter: {
                        category: tag.category,
                        subcategory: tag.subcategory,
                        icon: tag.icon,
                      },
                    },
                  );
                }}
              >
                <span>{tag.icon}</span>
                <span>{tag.subcategory}</span>
              </button>
            ))}
          </div>
        </InfoSection>
      )}

      {detail.gpsLatitude != null && detail.gpsLongitude != null && (
        <InfoSection icon={<MapPin className="h-3 w-3" />} title="位置">
          <InfoRow
            label="坐标"
            value={`${detail.gpsLatitude.toFixed(6)}, ${detail.gpsLongitude.toFixed(6)}`}
          />
          {detail.gpsAltitude != null && (
            <InfoRow
              label="海拔"
              value={`${Math.round(detail.gpsAltitude)}m`}
            />
          )}
          {detail.locationName && (
            <InfoRow label="地点" value={detail.locationName} />
          )}
          {detail.geoAddress && detail.geoAddress !== detail.locationName && (
            <InfoRow label="详细地址" value={detail.geoAddress} />
          )}
          {detail.geoProvince && (
            <InfoRow
              label="行政区划"
              value={[
                detail.geoProvince,
                detail.geoCity,
                detail.geoDistrict,
                detail.geoTownship,
              ]
                .filter(Boolean)
                .join(" / ")}
            />
          )}
          <PhotoMiniMap
            appId={detail.appId}
            latitude={detail.gpsLatitude}
            longitude={detail.gpsLongitude}
            onViewNearby={handleViewNearby}
          />
        </InfoSection>
      )}

      {ocrResults && ocrResults.length > 0 && (
        <InfoSection
          icon={<ScanText className="h-3 w-3" />}
          title="文字识别"
          actions={
            <button
              type="button"
              onClick={handleAddOcr}
              className="rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
              title="手动新增识别区域"
            >
              <Plus className="h-3 w-3" />
            </button>
          }
        >
          <div className="space-y-1.5">
            {ocrResults.map((r) => (
              <OcrResultRow
                key={r.id}
                r={r}
                isHovered={aiState.hoveredOcrId === r.id}
                isEditing={aiState.editingOcrId === r.id}
                range={aiState.ocrSelectionRanges.get(r.id)}
                pendingBbox={
                  aiState.editingOcrId === r.id
                    ? aiState.pendingBbox
                    : undefined
                }
                onHover={(id) => setHoveredOcrId(photoId, id)}
                onStartEdit={() => setEditingOcrId(photoId, r.id)}
                onFinishEdit={() => setEditingOcrId(photoId, null)}
                onDelete={() => setEditingOcrId(photoId, null)}
              />
            ))}
          </div>
          {detail.ocrScannedAt && (
            <p className="mt-2 flex items-center gap-1 text-xs text-white/30">
              <span>
                识别于 {new Date(detail.ocrScannedAt).toLocaleString()}
                {formatOcrModelSuffix(ocrResults)}
                {formatOcrPositioningSuffix(ocrResults)}
              </span>
              {detail.ocrDebugInfo && (
                <button
                  type="button"
                  className="ml-1 inline-flex items-center rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
                  title="查看多模型识别详情"
                  onClick={() => {
                    if (!detail.ocrDebugInfo || !ocrResults) return;
                    shell.openModalWindow({
                      component: () =>
                        import("./OcrDebugWindow") as Promise<{
                          default: ComponentType<any>;
                        }>,
                      title: "OCR 调试",
                      width: 720,
                      height: 700,
                      metadata: {
                        debugInfo: detail.ocrDebugInfo,
                        mergedTexts: ocrResults.map((r) => r.text),
                      } as OcrDebugWindowMetadata as unknown as TaskMetadata,
                    });
                  }}
                >
                  <SearchCode className="h-3 w-3" />
                </button>
              )}
            </p>
          )}
        </InfoSection>
      )}

      {detail.description && (
        <InfoSection icon={<Sparkles className="h-3 w-3" />} title="智能描述">
          <p className="text-sm leading-relaxed text-white/80">
            {detail.description}
          </p>
        </InfoSection>
      )}

    </div>
  );
}

function formatOcrModelSuffix(
  ocrResults: PhotoOcrResultItem[],
): string | null {
  const modelName = getOcrModelName(ocrResults[0]?.modelName ?? null);
  return modelName ? ` · 识别模型: ${modelName}` : null;
}

function formatOcrPositioningSuffix(
  ocrResults: PhotoOcrResultItem[],
): string {
  const labels: Record<string, string> = {
    attention: "Attention 对齐",
    ctc: "CTC 对齐",
    canvas: "比例估算",
  };
  const types = [
    ...new Set(ocrResults.map((r) => r.positioningType ?? "canvas")),
  ];
  if (types.length === 1) return ` · 定位: ${labels[types[0]] ?? types[0]}`;
  const best = types.includes("attention")
    ? "attention"
    : types.includes("ctc")
      ? "ctc"
      : "canvas";
  return ` · 定位: ${labels[best]} (混合)`;
}
