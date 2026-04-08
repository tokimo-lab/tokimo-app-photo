// ── Types ────────────────────────────────────────────────────────────────
export type MapTheme = "auto" | "light" | "dark" | "satellite";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  city: string | null;
}

/** Info about a clicked cluster / marker — bbox for server query + label for breadcrumb */
export interface MapClusterSelection {
  label: string;
  count: number;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export interface PhotoMapViewProps {
  appId: string | undefined;
  onClusterClick?: (selection: MapClusterSelection) => void;
}

// ── Constants ────────────────────────────────────────────────────────────
const STORAGE_KEY_STYLE = "photo-map-style";
const STORAGE_KEY_CENTER = "photo-map-center";
export const THUMB_SIZE = 50;

export function getStoredTheme(): MapTheme {
  const v = localStorage.getItem(STORAGE_KEY_STYLE);
  if (v === "light" || v === "dark" || v === "satellite" || v === "auto")
    return v;
  return "auto";
}

export function saveTheme(theme: MapTheme) {
  localStorage.setItem(STORAGE_KEY_STYLE, theme);
}

export function getEffectiveTheme(
  theme: MapTheme,
): "light" | "dark" | "satellite" {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function amapStyleForTheme(t: "light" | "dark" | "satellite"): string {
  if (t === "dark") return "amap://styles/dark";
  return "amap://styles/normal";
}

export function saveMapCenter(map: AMapInstance) {
  const zoom = map.getZoom();
  const center = map.getCenter();
  localStorage.setItem(
    STORAGE_KEY_CENTER,
    `${center.lng},${center.lat},${zoom}`,
  );
}

export function loadMapCenter(): {
  center: [number, number];
  zoom: number;
} | null {
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

// ── Cluster selection computation ─────────────────────────────────────
import type Supercluster from "supercluster";

/** Compute cluster/point selection info (bbox + label) for a map click. */
export function computeClusterSelection(
  sc: Supercluster,
  cluster:
    | Supercluster.ClusterFeature<Supercluster.AnyProps>
    | Supercluster.PointFeature<Supercluster.AnyProps>,
): MapClusterSelection | null {
  const isCluster = cluster.properties.cluster;

  if (!isCluster) {
    const [lng, lat] = cluster.geometry.coordinates;
    const city = cluster.properties.city as string | null;
    const PAD = 0.001;
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

  const leaves = sc.getLeaves(
    cluster.id as number,
    Number.POSITIVE_INFINITY,
    0,
  );
  if (leaves.length === 0) return null;

  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  const cityCount = new Map<string, number>();

  for (const leaf of leaves) {
    const [lng, lat] = leaf.geometry.coordinates;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    const city = leaf.properties.city as string | null;
    if (city) cityCount.set(city, (cityCount.get(city) ?? 0) + 1);
  }

  const latPad = Math.max((maxLat - minLat) * 0.01, 0.0001);
  const lngPad = Math.max((maxLng - minLng) * 0.01, 0.0001);

  let label: string;
  if (cityCount.size > 0) {
    let bestCity = "";
    let bestCount = 0;
    for (const [city, count] of cityCount) {
      if (count > bestCount) {
        bestCity = city;
        bestCount = count;
      }
    }
    label = cityCount.size > 1 ? `${bestCity}等` : bestCity;
  } else {
    const centerLat = ((minLat + maxLat) / 2).toFixed(2);
    const centerLng = ((minLng + maxLng) / 2).toFixed(2);
    label = `${centerLat}°N, ${centerLng}°E`;
  }

  return {
    label,
    count: leaves.length,
    bbox: {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    },
  };
}

// Minimal type aliases for AMap objects
export type AMapInstance = {
  getZoom(): number;
  getCenter(): { lng: number; lat: number; getLng(): number; getLat(): number };
  getBounds(): {
    getNorthEast(): { lng: number; lat: number };
    getSouthWest(): { lng: number; lat: number };
    northEast?: { lat: number; lng: number };
    southWest?: { lat: number; lng: number };
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
export type AMapSDK = Record<string, any>;
