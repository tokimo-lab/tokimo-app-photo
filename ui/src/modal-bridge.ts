import type { ShellApi } from "@tokimo/sdk";

interface SettingsBridge {
  kind: "settings";
  shell: ShellApi;
  photoId?: string;
  locale?: string;
  onMutated: () => void;
}

export type ModalBridge = SettingsBridge;

const registry = new Map<string, ModalBridge>();
let counter = 0;

export function registerBridge(bridge: ModalBridge): string {
  counter += 1;
  const id = `photo-bridge-${Date.now()}-${counter}`;
  registry.set(id, bridge);
  return id;
}

export function getBridge(id: string): ModalBridge | undefined {
  return registry.get(id);
}

// Do NOT call clearBridge from useEffect cleanup in modal windows; React 18 StrictMode dev double-invokes mount effects (mount → cleanup → mount), which would wipe the entry instantly after the modal commits; subsequent re-renders would then return null; modal windows must snapshot bridge once via useState(() => getBridge(id)); letting entries accumulate is fine — bounded by # of modal opens per session.
export function clearBridge(id: string): void {
  registry.delete(id);
}
