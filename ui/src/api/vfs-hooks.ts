/**
 * VFS API hooks for photo app — calls the main server's VFS endpoints directly.
 * Based on apps/tokimo-app-video/ui/src/api/hooks.ts VFS section.
 */

import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { FileProbeResult, VfsDto } from "./vfs-types";
import { vfsFetch } from "./vfs-client";

// ── VFS API hooks ─────────────────────────────────────────────────────────

const VFS_KEY = "vfs";

export const apiVfsList = {
  queryKey: (): unknown[] => [VFS_KEY, "list"],
  useQuery: (opts?: { enabled?: boolean }) =>
    useQuery({
      queryKey: apiVfsList.queryKey(),
      queryFn: () => vfsFetch<VfsDto[]>("/"),
      enabled: opts?.enabled,
    }),
  invalidate: (qc: QueryClient) =>
    qc.invalidateQueries({ queryKey: apiVfsList.queryKey() }),
};

export const apiVfsProbe = {
  queryKey: (input: { fileSystemId: string; path: string }): unknown[] => [
    VFS_KEY,
    "probe",
    input.fileSystemId,
    input.path,
  ],
  useQuery: (
    input: { fileSystemId: string; path: string },
    opts?: { enabled?: boolean },
  ) =>
    useQuery({
      queryKey: apiVfsProbe.queryKey(input),
      queryFn: () =>
        vfsFetch<FileProbeResult>(
          `/${encodeURIComponent(input.fileSystemId)}/probe?path=${encodeURIComponent(input.path)}`,
        ),
      enabled: opts?.enabled,
    }),
};
