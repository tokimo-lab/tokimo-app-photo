// Inline mini-map for photo info panel — shows the photo's location on an
// AMap widget with nearby-photo clusters that update on zoom / pan.
import AMapLoader from "@amap/amap-jsapi-loader";
import { useCallback, useEffect, useRef, useState } from "react";
import Supercluster from "supercluster";
import { api } from "@/generated/rust-api";
import type { MapClusterSelection } from "./PhotoMapView";

// ── Types ────────────────────────────────────────────────────────────────────

type AMapInstance = {
  getZoom(): number;
  setZoom(z: number): void;
  getCenter(): { lng: number; lat: number };
  setCenter(pos: [number, number]): void;
  getBounds(): {
    getNorthEast(): { lng: number; lat: number };
    getSouthWest(): { lng: number; lat: number };
  };
  setMapStyle(style: string): void;
  remove(marker: unknown): void;
  add(markers: unknown[] | unknown): void;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
  addControl(ctrl: unknown): void;
  destroy(): void;
};

// biome-ignore lint: AMap JS API returns untyped constructor functions
type AMapSDK = Record<string, any>;

interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  city: string | null;
}

interface PhotoMiniMapProps {
  appId: string;
  latitude: number;
  longitude: number;
  /** Called when user clicks a cluster to view nearby photos */
  onViewNearby?: (selection: MapClusterSelection) => void;
}

const THUMB_SIZE = 40;

/** Build a MapClusterSelection from a supercluster feature. */
function buildClusterSelection(
  sc: Supercluster,
  feature:
    | Supercluster.ClusterFeature<Supercluster.AnyProps>
    | Supercluster.PointFeature<Supercluster.AnyProps>,
): MapClusterSelection | null {
  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  if (!feature.properties.cluster) {
    const PAD = 0.001;
    const city = feature.properties.city as string | null;
    return {
      label: city || `${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`,
      count: 1,
      bbox: {
        minLat: lat - PAD,
        maxLat: lat + PAD,
        minLng: lng - PAD,
        maxLng: lng + PAD,
      },
    };
  }

  const count = feature.properties.point_count as number;
  const leaves = sc.getLeaves(feature.id as number, Infinity);
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  const cities = new Set<string>();
  for (const leaf of leaves) {
    const [lLng, lLat] = leaf.geometry.coordinates;
    if (lLat < minLat) minLat = lLat;
    if (lLat > maxLat) maxLat = lLat;
    if (lLng < minLng) minLng = lLng;
    if (lLng > maxLng) maxLng = lLng;
    if (leaf.properties.city) cities.add(leaf.properties.city as string);
  }
  const PAD = 0.002;
  return {
    label: cities.size === 1 ? [...cities][0] : `${count} 张照片`,
    count,
    bbox: {
      minLat: minLat - PAD,
      maxLat: maxLat + PAD,
      minLng: minLng - PAD,
      maxLng: maxLng + PAD,
    },
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function PhotoMiniMap({
  appId,
  latitude,
  longitude,
  onViewNearby,
}: PhotoMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapInstance | null>(null);
  const AMapRef = useRef<AMapSDK | null>(null);
  const markersRef = useRef<unknown[]>([]);
  const indexRef = useRef<Supercluster | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onViewNearbyRef = useRef(onViewNearby);
  onViewNearbyRef.current = onViewNearby;

  // ── Data ────────────────────────────────────────────────────────────────
  const geoSettings = api.photoSettings.getGeoSettings.useQuery({
    staleTime: 300_000,
  });
  const pointsQuery = api.app.getMapPoints.useQuery(
    { appId },
    { enabled: !!appId },
  );

  const amapJsKey = geoSettings.data?.amapJsApiKey ?? null;
  const amapSecret = geoSettings.data?.amapSecret ?? null;

  const points: MapPoint[] = pointsQuery.data
    ? (pointsQuery.data.filter(
        (p): p is MapPoint => p.lat != null && p.lng != null,
      ) as MapPoint[])
    : [];

  // ── Render markers ──────────────────────────────────────────────────────
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    const sc = indexRef.current;
    const AMap = AMapRef.current;
    if (!map || !sc || !AMap) return;

    for (const m of markersRef.current) map.remove(m);
    markersRef.current = [];

    const zoom = Math.round(map.getZoom());
    const bounds = map.getBounds();
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    const clusters = sc.getClusters([sw.lng, sw.lat, ne.lng, ne.lat], zoom);

    const newMarkers: unknown[] = [];
    for (const cluster of clusters) {
      const [cLng, cLat] = cluster.geometry.coordinates;
      if (!Number.isFinite(cLng) || !Number.isFinite(cLat)) continue;
      const isCluster = cluster.properties.cluster;
      const count = isCluster ? cluster.properties.point_count : 1;
      const photoId = isCluster
        ? sc.getLeaves(cluster.id as number, 1, 0)[0]?.properties.id
        : cluster.properties.id;

      const thumbUrl = photoId
        ? `/api/apps/photo/${photoId}/thumbnail?w=${THUMB_SIZE * 2}`
        : "";

      const el = document.createElement("div");
      el.className = "photo-map-marker photo-map-marker--mini";
      el.innerHTML = thumbUrl
        ? `<img src="${thumbUrl}" />${count > 1 ? `<span>${count}</span>` : ""}`
        : `<span>${count}</span>`;

      const marker = new AMap.Marker({
        content: el,
        position: [cLng, cLat],
        offset: new AMap.Pixel(-18, -18),
      });

      if (onViewNearbyRef.current) {
        const clusterRef = cluster;
        marker.on("click", () => {
          const sel = buildClusterSelection(sc, clusterRef);
          if (sel) onViewNearbyRef.current?.(sel);
        });
      }

      newMarkers.push(marker);
    }
    map.add(newMarkers);
    markersRef.current = newMarkers;
  }, []);

  // ── Build supercluster index ────────────────────────────────────────────
  useEffect(() => {
    if (points.length === 0) return;
    const sc = new Supercluster({ radius: 80, maxZoom: 20 });
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

  // ── Init AMap ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !amapJsKey || mapRef.current) return;

    if (amapSecret) {
      (window as unknown as Record<string, unknown>)._AMapSecurityConfig = {
        securityJsCode: amapSecret,
      };
    }

    let destroyed = false;
    const loader = AMapLoader as unknown as { reset?: () => void };
    loader.reset?.();

    AMapLoader.load({
      key: amapJsKey,
      version: "1.4.15",
      plugins: ["AMap.Scale"],
    })
      .then((AMap: AMapSDK) => {
        if (destroyed || !containerRef.current) return;
        AMapRef.current = AMap;

        const isDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;

        const map = new AMap.Map(containerRef.current!, {
          zoom: 14,
          center: [longitude, latitude],
          zooms: [3, 20],
          resizeEnable: true,
          mapStyle: isDark ? "amap://styles/dark" : "amap://styles/normal",
          showLabel: true,
          dragEnable: true,
          zoomEnable: true,
          scrollWheel: true,
        }) as unknown as AMapInstance;
        mapRef.current = map;

        map.addControl(new AMap.Scale({ visible: true }));

        map.on("complete", () => {
          if (!destroyed) setMapReady(true);
        });
      })
      .catch((e: unknown) => {
        console.error("[PhotoMiniMap] AMap load failed:", e);
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
  }, [amapJsKey, amapSecret, latitude, longitude]);

  // ── Map events ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    const handler = () => updateMarkers();
    const map = mapRef.current;
    map.on("moveend", handler);
    map.on("zoomend", handler);
    updateMarkers();

    return () => {
      map.off("moveend", handler);
      map.off("zoomend", handler);
    };
  }, [mapReady, updateMarkers]);

  // ── No API key: fallback to "open in Amap" link ─────────────────────────
  if (geoSettings.isLoading) {
    return (
      <div className="mt-2 flex h-40 items-center justify-center rounded-lg bg-white/5">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
      </div>
    );
  }

  if (!amapJsKey) {
    return (
      <a
        href={`https://uri.amap.com/marker?position=${longitude},${latitude}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
      >
        在高德地图中打开
      </a>
    );
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10">
      <div ref={containerRef} className="h-48 w-full" />
    </div>
  );
}
