/**
 * PhotoAiInfoExtras — Extension version of PhotoInfoPanel's AI sections.
 *
 * Based on the original PhotoInfoPanel.tsx (git 6ad99cd74^).
 * Removed: Details section, Camera section (already in shell's PhotoInfoPanel).
 * Adapted: useWindowActions → useRuntimeCtx().shell.windowManager,
 *          useDateFormat → inline formatting.
 */

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
import { useCallback } from "react";
import type { PhotoDetailOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { getOcrModelName } from "@/lib/ocr-models";
import { thumbUrl } from "@/lib/thumb";
import { useRuntimeCtx } from "@tokimo/sdk";
import { OcrResultRow } from "./OcrResultRow";
import { PhotoFacesPanel } from "./PhotoFacesPanel";
import { PhotoMiniMap } from "./PhotoMiniMap";
import { PhotoToolsPanel } from "./PhotoToolsPanel";
import {
  InfoRow,
  InfoSection,
} from "./info-panel-helpers";
import {
  usePhotoAiState,
  setHoveredFaceId,
  setHoveredOcrId,
  setEditingOcrId,
} from "./PhotoAiStore";

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

  const { data: detail } = api.photo.getPhoto.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

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

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/apps/photo/item/{id}"] });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/item/{id}/faces"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/apps/photo/item/{id}/ocr-results"],
    });
  }, [queryClient]);

  const handleViewNearby = useCallback(
    (selection: import("./PhotoMapView").MapClusterSelection) => {
      shell.windowManager.openWindow({
        type: "page",
        appId,
        title: selection.label,
        metadata: {
          appId,
          tab: "locations",
          locationBbox: selection,
        },
        forceNew: true,
      });
    },
    [shell.windowManager, appId],
  );

  const handleNavigateToPerson = useCallback(
    (personId: string) => {
      shell.windowManager.openWindow({
        type: "page",
        appId,
        title: "人物",
        metadata: {
          appId,
          tab: "people",
          personId,
        },
        forceNew: true,
      });
    },
    [shell.windowManager, appId],
  );

  if (!detail) return null;

  const hasGps = detail.gpsLatitude != null && detail.gpsLongitude != null;

  return (
    <div className="space-y-4">
      {/* ── People section ──────────────────────────────────────── */}
      <PhotoFacesPanel
        photoId={detail.id}
        appId={detail.appId}
        photoWidth={detail.width}
        photoHeight={detail.height}
        hoveredFaceId={aiState.hoveredFaceId}
        onHoverFace={(id) => setHoveredFaceId(photoId, id)}
        onNavigateToPerson={handleNavigateToPerson}
      />

      {/* ── Similar photos (CLIP) section ────────────────────────── */}
      {similarData?.indexed && similarData.items.length > 0 && (
        <InfoSection
          icon={<Search className="h-3 w-3" />}
          title="相似照片"
          actions={
            <button
              type="button"
              onClick={() => {
                shell.windowManager.openWindow({
                  type: "page",
                  appId,
                  title: "相似照片",
                  metadata: {
                    appId,
                    tab: "timeline",
                    similarSourceId: detail.id,
                  },
                  forceNew: true,
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
                    appId,
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

      {/* ── AI Tags (CLIP zero-shot) section ────────────────────── */}
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
                  shell.windowManager.openWindow({
                    type: "page",
                    appId,
                    title: `${tag.icon} ${tag.subcategory}`,
                    metadata: {
                      appId,
                      tab: "timeline",
                      tagFilter: {
                        category: tag.category,
                        subcategory: tag.subcategory,
                        icon: tag.icon,
                      },
                    },
                    forceNew: true,
                  });
                }}
              >
                <span>{tag.icon}</span>
                <span>{tag.subcategory}</span>
              </button>
            ))}
          </div>
        </InfoSection>
      )}

      {/* ── Location section ────────────────────────────────────── */}
      {hasGps && (
        <InfoSection icon={<MapPin className="h-3 w-3" />} title="位置">
          <InfoRow
            label="坐标"
            value={`${detail.gpsLatitude!.toFixed(6)}, ${detail.gpsLongitude!.toFixed(6)}`}
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
            latitude={detail.gpsLatitude!}
            longitude={detail.gpsLongitude!}
            onViewNearby={handleViewNearby}
          />
        </InfoSection>
      )}

      {/* ── OCR text section ──────────────────────────────────── */}
      {ocrResults && ocrResults.length > 0 && (
        <InfoSection
          icon={<ScanText className="h-3 w-3" />}
          title="文字识别"
          actions={
            <button
              type="button"
              onClick={() => {
                const pw = detail.width || 1000;
                const ph = detail.height || 1000;
                const w = Math.round(pw * 0.2);
                const h = Math.round(ph * 0.04);
                const x = Math.round((pw - w) / 2);
                const y = Math.round((ph - h) / 2);
                api.photo.createOcrResult
                  .mutate({ photoId: detail.id, text: "", x, y, w, h })
                  .then(() => {
                    queryClient.invalidateQueries({
                      queryKey: ["/api/apps/photo/item/{id}/ocr-results"],
                    });
                  })
                  .catch(() => {});
              }}
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
                  aiState.editingOcrId === r.id ? aiState.pendingBbox : undefined
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
                识别于{" "}
                {new Date(detail.ocrScannedAt).toLocaleString()}
                {(() => {
                  const modelName = getOcrModelName(
                    ocrResults[0]?.modelName ?? null,
                  );
                  return modelName ? ` · 识别模型: ${modelName}` : null;
                })()}
                {(() => {
                  const TIER_LABELS: Record<string, string> = {
                    attention: "Attention 对齐",
                    ctc: "CTC 对齐",
                    canvas: "比例估算",
                  };
                  const types = [
                    ...new Set(
                      ocrResults.map((r) => r.positioningType ?? "canvas"),
                    ),
                  ];
                  if (types.length === 1) {
                    return ` · 定位: ${TIER_LABELS[types[0]] ?? types[0]}`;
                  }
                  const best = types.includes("attention")
                    ? "attention"
                    : types.includes("ctc")
                      ? "ctc"
                      : "canvas";
                  return ` · 定位: ${TIER_LABELS[best]} (混合)`;
                })()}
              </span>
              {detail.ocrDebugInfo && (
                <button
                  type="button"
                  className="ml-1 inline-flex items-center rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/60"
                  title="查看多模型识别详情"
                  onClick={() => {
                    if (!detail.ocrDebugInfo || !ocrResults) return;
                    shell.openModalWindow({
                      component: () => import("./OcrDebugWindow"),
                      title: "OCR 调试",
                      width: 720,
                      height: 700,
                      metadata: {
                        debugInfo: detail.ocrDebugInfo,
                        mergedTexts: ocrResults.map((r) => r.text),
                      },
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

      {/* ── AI recognition section ─────────────────────────────── */}
      {detail.description && (
        <InfoSection icon={<Sparkles className="h-3 w-3" />} title="智能描述">
          <p className="text-sm leading-relaxed text-white/80">
            {detail.description}
          </p>
        </InfoSection>
      )}

      {/* ── Tools section ───────────────────────────────────────── */}
      <PhotoToolsPanel
        photoId={detail.id}
        onRefreshComplete={invalidateAll}
      />
    </div>
  );
}
