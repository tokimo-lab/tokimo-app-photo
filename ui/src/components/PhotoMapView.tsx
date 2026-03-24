import AMapLoader from "@amap/amap-jsapi-loader";
import { Empty, Spin } from "@tokiomo/components";
import { Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Supercluster from "supercluster";
import { api } from "../../generated/rust-api";
import { useWindowNav } from "../window-manager/WindowNavContext";

// ── Types ────────────────────────────────────────────────────────────────
type MapTheme = "auto" | "light" | "dark" | "satellite";

interface MapPoint {
  id: string;
  lat: number;
  lng: number;
}

interface PhotoMapViewProps {
  appId: string | undefined;
}

// ── Constants ────────────────────────────────────────────────────────────
const STORAGE_KEY_STYLE = "photo-map-style";
const STORAGE_KEY_CENTER = "photo-map-center";
const THUMB_SIZE = 50;

function getStoredTheme(): MapTheme {
  const v = localStorage.getItem(STORAGE_KEY_STYLE);
  if (v === "light" || v === "dark" || v === "satellite" || v === "auto")
    return v;
  return "auto";
}

function getEffectiveTheme(theme: MapTheme): "light" | "dark" | "satellite" {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function amapStyleForTheme(t: "light" | "dark" | "satellite"): string {
  if (t === "dark") return "amap://styles/dark";
  return "amap://styles/normal";
}

function saveMapCenter(map: AMapInstance) {
  const zoom = map.getZoom();
  const center = map.getCenter();
  localStorage.setItem(
    STORAGE_KEY_CENTER,
    `${center.lng},${center.lat},${zoom}`,
  );
}

function loadMapCenter(): { center: [number, number]; zoom: number } | null {
  const raw = localStorage.getItem(STORAGE_KEY_CENTER);
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 3) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  const zoom = Number(parts[2]);
  if (Number.isNaN(lng) || Number.isNaN(lat) || Number.isNaN(zoom)) return null;
  return { center: [lng, lat], zoom };
}

// Minimal type aliases for AMap objects
type AMapInstance = {
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBounds(): {
    northEast: { lat: number; lng: number };
    southWest: { lat: number; lng: number };
  };
  setMapStyle(style: string): void;
  getLayers(): Array<{ CLASS_NAME?: string; show(): void; hide(): void }>;
  remove(marker: unknown): void;
  add(markers: unknown[] | unknown): void;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  addControl(ctrl: unknown): void;
  destroy(): void;
};

// AMap SDK type (loaded dynamically)
// biome-ignore lint: AMap JS API returns untyped constructor functions
type AMapSDK = Record<string, any>;

// ── Component ────────────────────────────────────────────────────────────
export function PhotoMapView({ appId }: PhotoMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const markersRef = useRef<unknown[]>([]);
  const indexRef = useRef<Supercluster | null>(null);
  const AMapRef = useRef<AMapSDK | null>(null);
  const satelliteLayerRef = useRef<unknown>(null);

  const [mapTheme, setMapTheme] = useState<MapTheme>(getStoredTheme);
  const [mapReady, setMapReady] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const initialThemeRef = useRef(mapTheme);

  const { openWindow } = useWindowNav();

  // ── Data queries ─────────────────────────────────────────────────────
  const geoSettings = api.photoSettings.getGeoSettings.useQuery({
    staleTime: 300_000,
  });
  const pointsQuery = api.app.getMapPoints.useQuery(
    { appId: appId! },
    { enabled: !!appId },
  );

  const amapJsKey = geoSettings.data?.amapJsApiKey ?? null;
  const amapSecret = geoSettings.data?.amapSecret ?? null;

  const points: MapPoint[] = useMemo(() => {
    if (!pointsQuery.data) return [];
    return pointsQuery.data.filter(
      (p): p is { id: string; lat: number; lng: number } =>
        p.lat != null && p.lng != null,
    );
  }, [pointsQuery.data]);

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
    const { northEast, southWest } = bounds;
    const clusters = sc.getClusters(
      [southWest.lng, southWest.lat, northEast.lng, northEast.lat],
      zoom,
    );

    const newMarkers: unknown[] = [];
    for (const cluster of clusters) {
      const [lng, lat] = cluster.geometry.coordinates;
      const isCluster = cluster.properties.cluster;
      const count = isCluster ? cluster.properties.point_count : 1;
      const photoId = isCluster
        ? sc.getLeaves(cluster.id as number, 1, 0)[0]?.properties.id
        : cluster.properties.id;

      const thumbUrl = photoId
        ? `/api/photos/${photoId}/thumbnail?w=${THUMB_SIZE * 2}`
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
        anchor: "center",
      });
      newMarkers.push(marker);
    }
    map.add(newMarkers);
    markersRef.current = newMarkers;

    saveMapCenter(map);
  }, []);

  // ── Supercluster index ───────────────────────────────────────────────
  useEffect(() => {
    if (points.length === 0) return;
    const sc = new Supercluster({ radius: 120, maxZoom: 20 });
    sc.load(
      points.map((p) => ({
        type: "Feature" as const,
        properties: { id: p.id },
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

    AMapLoader.load({
      key: amapJsKey,
      version: "2.0",
      plugins: ["AMap.Scale", "AMap.ToolBar", "AMap.ControlBar"],
    })
      .then((AMap: AMapSDK) => {
        if (destroyed || !containerRef.current) return;

        AMapRef.current = AMap;
        const saved = loadMapCenter();
        const eff = getEffectiveTheme(initialThemeRef.current);
        const isSatellite = eff === "satellite";

        const mapOptions: Record<string, unknown> = {
          zoom: saved?.zoom ?? 5,
          center: saved?.center ?? [104.07, 30.67],
          mapStyle: amapStyleForTheme(eff),
          rotateEnable: true,
          pitchEnable: true,
          viewMode: "3D",
          zooms: [2, 21],
          resizeEnable: true,
        };

        if (isSatellite) {
          mapOptions.layers = [
            AMap.createDefaultLayer(),
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
        map.addControl(
          new AMap.ToolBar({
            position: { top: "110px", right: "40px" },
          }),
        );
        map.addControl(
          new AMap.ControlBar({
            position: { top: "10px", right: "10px" },
          }),
        );

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
      localStorage.setItem(STORAGE_KEY_STYLE, t);
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

  // ── Loading / empty states ───────────────────────────────────────────
  if (geoSettings.isLoading || pointsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (!amapJsKey) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty
          description={
            <span>
              请先
              <button
                type="button"
                className="text-[var(--accent-text)] hover:underline"
                onClick={() =>
                  openWindow({
                    type: "page",
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
    );
  }

  if (points.length === 0 && !pointsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty description="暂无带有 GPS 坐标的照片" />
      </div>
    );
  }

  const themes: { key: MapTheme; label: string }[] = [
    { key: "auto", label: "自动" },
    { key: "light", label: "浅色" },
    { key: "dark", label: "深色" },
    { key: "satellite", label: "卫星图" },
  ];

  return (
    <div className="relative h-full w-full">
      {/* Map container */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Theme switcher */}
      <div ref={themeMenuRef} className="absolute top-3 left-3 z-10">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-sm font-medium text-neutral-700 shadow-md backdrop-blur-sm transition-colors hover:bg-white dark:bg-neutral-800/90 dark:text-neutral-200 dark:hover:bg-neutral-800"
          onClick={() => setThemeOpen(!themeOpen)}
        >
          <Layers className="h-4 w-4" />
          {themes.find((t) => t.key === mapTheme)?.label}
        </button>

        {themeOpen && (
          <div className="mt-1 overflow-hidden rounded-lg bg-white/95 shadow-lg backdrop-blur-sm dark:bg-neutral-800/95">
            {themes.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                  mapTheme === t.key
                    ? "font-medium text-blue-600 dark:text-blue-400"
                    : "text-neutral-700 dark:text-neutral-300"
                }`}
                onClick={() => handleSetTheme(t.key)}
              >
                {mapTheme === t.key && (
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
                <span className={mapTheme === t.key ? "" : "pl-3.5"}>
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Photo count badge */}
      <div className="absolute bottom-3 left-3 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white backdrop-blur-sm">
        {points.length} 张照片
      </div>
    </div>
  );
}
