import { Button, Modal, Spin } from "@tokimo/ui";
import { Grid3x3, Plus } from "lucide-react";
import { useState } from "react";
import type { PhotoAlbumOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { thumbUrl } from "@/lib/thumb";

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
  const albumsQuery = api.photo.listPhotoAlbums.useQuery(
    { id: appId },
    { enabled: true },
  );
  const albums = albumsQuery.data ?? [];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const createMutation = api.photo.createPhotoAlbum.useMutation({
    onSuccess: (album: PhotoAlbumOutput) => {
      void albumsQuery.refetch();
      onPick(album.id);
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ id: appId, name: newName.trim() });
  };

  return (
    <Modal
      open
      title={
        <div>
          <div>添加到相册</div>
          <div className="text-xs font-normal text-[var(--text-muted)] mt-0.5">
            将 {selectedCount} 张照片添加到相册
          </div>
        </div>
      }
      onCancel={onClose}
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose} disabled={isPending}>
            取消
          </Button>
        </div>
      }
      width={448}
    >
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
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.06]"
              onClick={() => onPick(album.id)}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fill-tertiary">
                {album.coverPhotoId ? (
                  <img
                    src={thumbUrl("photo", album.coverPhotoId, 80)}
                    alt=""
                    className="h-full w-full rounded-lg object-cover"
                  />
                ) : (
                  <Grid3x3 className="h-5 w-5 text-fg-muted" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {album.name}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {album.photoCount} 张
                </p>
              </div>
            </button>
          ))}

          {albums.length === 0 && !showCreate && (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">
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
            className="min-w-0 flex-1 rounded-lg border border-black/[0.15] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-white/[0.15]"
            placeholder="相册名称"
            onKeyDown={(e) =>
              e.key === "Enter" && !e.nativeEvent.isComposing && handleCreate()
            }
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
          className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg p-2.5 text-sm text-[var(--text-muted)] transition-colors hover:bg-black/[0.04] hover:text-[var(--text-secondary)] dark:hover:bg-white/[0.06]"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="h-4 w-4" />
          新建相册
        </button>
      )}
    </Modal>
  );
}
