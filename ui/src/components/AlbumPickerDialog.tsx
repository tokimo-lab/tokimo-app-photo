import { Button, Spin } from "@tokiomo/components";
import { Grid3x3, Plus } from "lucide-react";
import { useState } from "react";
import type { PhotoAlbumOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";

export function AlbumPickerDialog({
  appId,
  selectedCount,
  onPick,
  onClose,
  isPending,
}: {
  appId: string;
  selectedCount: number;
  onPick: (albumId: string) => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const albumsQuery = api.app.listPhotoAlbums.useQuery(
    { appId },
    { enabled: true },
  );
  const albums = albumsQuery.data ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const createMutation = api.app.createPhotoAlbum.useMutation({
    onSuccess: (album: PhotoAlbumOutput) => {
      void albumsQuery.refetch();
      onPick(album.id);
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ appId, name: newName.trim() });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-[var(--glass-border)] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <h3 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          添加到相册
        </h3>
        <p className="mb-4 text-sm text-neutral-500">
          将 {selectedCount} 张照片添加到相册
        </p>

        {albumsQuery.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Spin />
          </div>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {albums.map((album) => (
              <button
                key={album.id}
                type="button"
                disabled={isPending}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:hover:bg-neutral-800"
                onClick={() => onPick(album.id)}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800">
                  {album.coverPhotoId ? (
                    <img
                      src={`/api/photos/${album.coverPhotoId}/thumbnail?w=80`}
                      alt=""
                      className="h-full w-full rounded-lg object-cover"
                    />
                  ) : (
                    <Grid3x3 className="h-5 w-5 text-neutral-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {album.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {album.photoCount} 张
                  </p>
                </div>
              </button>
            ))}

            {albums.length === 0 && !showCreate && (
              <p className="py-4 text-center text-sm text-neutral-500">
                暂无相册
              </p>
            )}
          </div>
        )}

        {/* Create new album inline */}
        {showCreate ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="相册名称"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              loading={createMutation.isPending}
            >
              创建
            </Button>
            <Button onClick={() => setShowCreate(false)}>取消</Button>
          </div>
        ) : (
          <button
            type="button"
            className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg p-2.5 text-sm text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4" />
            新建相册
          </button>
        )}

        {/* Footer */}
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose} disabled={isPending}>
            取消
          </Button>
        </div>
      </div>
    </div>
  );
}
