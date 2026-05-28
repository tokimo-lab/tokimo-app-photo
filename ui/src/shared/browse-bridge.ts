import type { ShellApi } from "@tokimo/sdk";

export interface BrowseBridge {
  kind: "vfs-browse";
  shell: ShellApi;
  initialPath: string;
  sourceId?: string;
  protocolPrefix?: string;
  resolve: (path: string | null) => void;
}

const registry = new Map<string, BrowseBridge>();
let counter = 0;

export function registerBrowseBridge(bridge: BrowseBridge): string {
  counter += 1;
  const id = `photo-browse-${Date.now()}-${counter}`;
  registry.set(id, bridge);
  return id;
}

export function getBrowseBridge(id: string): BrowseBridge | undefined {
  return registry.get(id);
}

export function clearBrowseBridge(id: string): void {
  registry.delete(id);
}
