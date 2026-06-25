// Photo Map View — AMap JS API v1.4 + Supercluster clustering
import AMapLoader from "@amap/amap-jsapi-loader";
import { Empty, Spin } from "@tokimo/ui";
import { Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Supercluster from "supercluster";
import { api } from "../generated/rust-api";
import { thumbUrl as photoThumbUrl } from "../lib/thumb";
import { useComponentPreference, useWindowNav } from "@tokimo/sdk";
import {
  type AMapInstance,
  type AMapSDK,
  amapStyleForTheme,
  computeClusterSelection,
  getEffectiveTheme,
  type MapClusterSelection,
  type MapPoint,
  type MapTheme,
  THUMB_SIZE,
} from "./map-utils";

export type { MapClusterSelection } from "./map-utils";

// ── Component ────────────────────────────────────────────────────────────
export function PhotoMapView({
  appId,
  onClusterClick,
}: {
  appId: string | undefined;
  onClusterClick?: (selection: MapClusterSelection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const markersRef = useRef<unknown[]>([]);
  const indexRef = useRef<Supercluster | null>(null);
  const AMapRef = useRef<AMapSDK | null>(null);
  const satelliteLayerRef = useRef<unknown>(null);

  const mapPref = useComponentPreference<{
    theme?: MapTheme;
    center?: string;
  }>("photo-map");
  const [mapTheme, setMapTheme] = useState<MapTheme>(
    () => mapPref.data.theme ?? "auto",
  );
  const [mapReady, setMapReady] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const initialThemeRef = useRef(mapTheme);
  const mapPrefRef = useRef(mapPref);
  mapPrefRef.current = mapPref;

  const { openWindow } = useWindowNav();

  // ── Data queries ─────────────────────────────────────────────────────
  const geoSettings = api.photo.getGeoSettings.useQuery({
    staleTime: 300_000,
  });
  const pointsQuery = api.photo.getMapPoints.useQuery(
    { id: appId! },
    { enabled: !!appId },
  );

  const amapJsKey = geoSettings.data?.amapJsApiKey ?? null;
  const amapSecret = geoSettings.data?.amapSecret ?? null;

  const points: MapPoint[] = useMemo(() => {
    if (!pointsQuery.data) return [];
    return pointsQuery.data.filter(
      (p): p is { id: string; lat: number; lng: number; city: string | null } =>
        p.lat != null && p.lng != null,
    );
  }, [pointsQuery.data]);

  // ── Ref for onClusterClick (avoids re-creating updateMarkers) ─────────
  const onClusterClickRef = useRef(onClusterClick);
  onClusterClickRef.current = onClusterClick;

  // ── Update markers ───────────────────────────────────────────────────
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const sc = indexRef.current;
    const AMap = AMapRef.current;
    if (!map || !sc || !AMap) return;

    // Remove old markers
    for (const m of markersRef.current) map.remove(m);
    markersRef.current = [];

    const zoom = Math.round(map.getZoom());
    const bounds = map.getBounds();
    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    const clusters = sc.getClusters(
      [southWest.lng, southWest.lat, northEast.lng, northEast.lat],
      zoom,
    );

    const onClickRef = onClusterClickRef.current;
    const newMarkers: unknown[] = [];
    for (const cluster of clusters) {
      const [lng, lat] = cluster.geometry.coordinates;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const isCluster = cluster.properties.cluster;
      const count = isCluster ? cluster.properties.point_count : 1;
      const photoId = isCluster
        ? sc.getLeaves(cluster.id as number, 1, 0)[0]?.properties.id
        : cluster.properties.id;

      const thumbUrl = photoId
        ? photoThumbUrl("photo", photoId, THUMB_SIZE * 2)
        : "";

      const iconContent = document.createElement("div");
      iconContent.className = "photo-map-marker";
      iconContent.innerHTML = thumbUrl
        ? `<img src="${thumbUrl}" />${count > 1 ? `<span>${count}</span>` : ""}`
        : `<span>${count}</span>`;

      const marker = new AMap.Marker({
        content: iconContent,
        position: [lng, lat],
        offset: new AMap.Pixel(-24, -24),
      });

      // Click → drill into cluster's photos as timeline
      if (onClickRef) {
        const clusterRef = cluster;
        marker.on("click", () => {
          const sel = computeClusterSelection(sc, clusterRef);
          if (sel) onClickRef(sel);
        });
      }

      newMarkers.push(marker);
    }
    map.add(newMarkers);
    markersRef.current = newMarkers;

    const center = map.getCenter();
    mapPrefRef.current.patch({
      center: `${center.lng},${center.lat},${zoom}`,
    });
  }, []);

  // ── Supercluster index ───────────────────────────────────────────────
  useEffect(() => {
    if (points.length === 0) return;
    const sc = new Supercluster({ radius: 120, maxZoom: 20 });
    sc.load(
      points.map((p) => ({
        type: "Feature" as const,
        properties: { id: p.id, city: p.city },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    );
    indexRef.current = sc;
    if (mapReady) updateMarkers();
  }, [points, mapReady, updateMarkers]);

  // ── Apply theme to existing map ──────────────────────────────────────
  const applyTheme = useCallback((theme: MapTheme) => {
    const map = mapRef.current;
    const AMap = AMapRef.current;
    if (!map || !AMap) return;

    const eff = getEffectiveTheme(theme);
    map.setMapStyle(amapStyleForTheme(eff));

    // Handle satellite layer
    const satLayer = satelliteLayerRef.current as {
      show(): void;
      hide(): void;
    } | null;
    if (eff === "satellite") {
      if (!satLayer) {
        const layer = new AMap.TileLayer.Satellite({ zIndex: 11 });
        satelliteLayerRef.current = layer;
        map.add(layer);
      } else {
        satLayer.show();
      }
      // Hide buildings
      for (const l of map.getLayers()) {
        if (l.CLASS_NAME === "AMap.Buildings") l.hide();
      }
    } else {
      if (satLayer) satLayer.hide();
      for (const l of map.getLayers()) {
        if (l.CLASS_NAME === "AMap.Buildings") l.show();
      }
    }
  }, []);

  // ── Init map ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !amapJsKey || mapRef.current) return;

    if (amapSecret) {
      (window as unknown as Record<string, unknown>)._AMapSecurityConfig = {
        securityJsCode: amapSecret,
      };
    }

    let destroyed = false;

    // Clean any stale AMap SDK state from previous HMR cycles
    const loader = AMapLoader as unknown as { reset?: () => void };
    loader.reset?.();

    AMapLoader.load({
      key: amapJsKey,
      version: "1.4.15",
      plugins: ["AMap.Scale", "AMap.ToolBar"],
    })
      .then((AMap: AMapSDK) => {
        if (destroyed || !containerRef.current) return;

        AMapRef.current = AMap;
        const savedCenter = (() => {
          const raw = mapPrefRef.current.data.center;
          if (!raw) return null;
          const parts = raw.split(",");
          if (parts.length !== 3) return null;
          const lng = Number(parts[0]);
          const lat = Number(parts[1]);
          const zoom = Number(parts[2]);
          if (Number.isNaN(lng) || Number.isNaN(lat) || Number.isNaN(zoom))
            return null;
          return { center: [lng, lat] as [number, number], zoom };
        })();
        const eff = getEffectiveTheme(initialThemeRef.current);
        const isSatellite = eff === "satellite";

        const mapOptions: Record<string, unknown> = {
          zoom: savedCenter?.zoom ?? 5,
          center: savedCenter?.center ?? [104.07, 30.67],
          zooms: [3, 20],
          resizeEnable: true,
          mapStyle: amapStyleForTheme(eff),
        };

        if (isSatellite) {
          mapOptions.layers = [
            new AMap.TileLayer(),
            new AMap.TileLayer.Satellite(),
          ];
        }

        const map = new AMap.Map(
          containerRef.current!,
          mapOptions,
        ) as unknown as AMapInstance;
        mapRef.current = map;

        if (isSatellite) {
          const layers = map.getLayers();
          for (const l of layers) {
            if (l.CLASS_NAME === "AMap.TileLayer.Satellite") {
              satelliteLayerRef.current = l;
            }
          }
        }

        // Controls
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ liteStyle: true }));

        map.on("complete", () => {
          if (!destroyed) setMapReady(true);
        });
      })
      .catch((e: unknown) => {
        console.error("AMap load failed:", e);
      });

    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
      const resetLoader = AMapLoader as unknown as { reset?: () => void };
      resetLoader.reset?.();
    };
    // Only run once when key becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amapJsKey, amapSecret]);

  // ── Attach map events & render markers when ready ────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const handler = () => updateMarkers();
    const map = mapRef.current;
    map.on("moveend", handler);
    map.on("zoomend", handler);

    // Initial render
    updateMarkers();

    return () => {
      map.off("moveend", handler);
      map.off("zoomend", handler);
    };
  }, [mapReady, updateMarkers]);

  // ── Theme changes ────────────────────────────────────────────────────
  const handleSetTheme = useCallback(
    (t: MapTheme) => {
      setMapTheme(t);
      mapPrefRef.current.patch({ theme: t });
      setThemeOpen(false);
      applyTheme(t);
    },
    [applyTheme],
  );

  // Follow system theme when in auto mode
  useEffect(() => {
    if (mapTheme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mapTheme, applyTheme]);

  // Close theme menu on outside click
  useEffect(() => {
    if (!themeOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        themeMenuRef.current &&
        !themeMenuRef.current.contains(e.target as Node)
      ) {
        setThemeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [themeOpen]);

  // ── Overlay state ────────────────────────────────────────────────────
  const isLoading = geoSettings.isLoading || pointsQuery.isLoading;
  const noKey = !isLoading && !amapJsKey;
  const noPoints =
    !isLoading && !noKey && points.length === 0 && !pointsQuery.isLoading;
  const showMap = !isLoading && !noKey && !noPoints;

  const themes: { key: MapTheme; label: string }[] = [
    { key: "auto", label: "自动" },
    { key: "light", label: "浅色" },
    { key: "dark", label: "深色" },
    { key: "satellite", label: "卫星图" },
  ];

  return (
    <div className="relative w-full" style={{ height: "calc(100vh - 120px)" }}>
      {/* Map container — always mounted so the ref is available for AMap init */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Overlay: loading */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/60">
          <Spin />
        </div>
      )}

      {/* Overlay: no API key */}
      {noKey && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/60">
          <Empty
            description={
              <span>
                请先
                <button
                  type="button"
                  className="text-accent-text hover:underline"
                  onClick={() =>
                    openWindow({
                      type: "system",
                      title: "Settings",
                      metadata: { pageId: "external-database" },
                    })
                  }
                >
                  配置高德 JS API 密钥
                </button>
                以启用地图显示。
              </span>
            }
          />
        </div>
      )}

      {/* Overlay: no GPS photos */}
      {noPoints && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-900/60">
          <Empty description="暂无带有 GPS 坐标的照片" />
        </div>
      )}

      {/* Theme switcher */}
      {showMap && (
        <div ref={themeMenuRef} className="absolute top-3 left-3 z-10">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg border border-base bg-surface-overlay px-3 py-2 text-sm font-medium text-fg-primary shadow-md backdrop-blur-sm transition-colors hover:bg-surface-overlay-hover"
            onClick={() => setThemeOpen(!themeOpen)}
          >
            <Layers className="h-4 w-4" />
            {themes.find((t) => t.key === mapTheme)?.label}
          </button>

          {themeOpen && (
            <div className="mt-1 overflow-hidden rounded-lg bg-surface-overlay shadow-lg backdrop-blur-sm">
              {themes.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-fill-tertiary ${
                    mapTheme === t.key
                      ? "font-medium text-accent-text"
                      : "text-fg-secondary"
                  }`}
                  onClick={() => handleSetTheme(t.key)}
                >
                  {mapTheme === t.key && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                  <span className={mapTheme === t.key ? "" : "pl-3.5"}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Photo count badge */}
      {showMap && (
        <div className="absolute bottom-3 left-3 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white backdrop-blur-sm">
          {points.length} 张照片
        </div>
      )}
    </div>
  );
}
