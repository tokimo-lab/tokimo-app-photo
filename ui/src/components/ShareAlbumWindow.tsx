import type { ShellWindowHandle } from "@tokimo/sdk";
import { Button, Empty, Input, Spin } from "@tokimo/ui";
import { Copy, Link2, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { queryClient } from "../index";
import { api } from "../generated/rust-api";
import { getBridge, type ModalBridge } from "../modal-bridge";
import { withProviders } from "../shared/providers";

type ShareAlbumBridge = Extract<ModalBridge, { kind: "share-album" }>;

function ShareAlbumContent({
  win,
  bridge,
}: {
  win: ShellWindowHandle;
  bridge: ShareAlbumBridge;
}) {
  const [userId, setUserId] = useState("");
  const shareQuery = api.photo.getAlbumShare.useQuery({
    albumId: bridge.albumId,
  });
  const patchLinkMutation = api.photo.patchAlbumShareLink.useMutation({
    onSuccess: (data) =>
      api.photo.getAlbumShare.setData(
        queryClient,
        { albumId: bridge.albumId },
        data,
      ),
  });
  const addUserMutation = api.photo.putAlbumUserShare.useMutation({
    onSuccess: (data) => {
      setUserId("");
      api.photo.getAlbumShare.setData(
        queryClient,
        { albumId: bridge.albumId },
        data,
      );
    },
  });
  const deleteUserMutation = api.photo.deleteAlbumUserShare.useMutation({
    onSuccess: (data) =>
      api.photo.getAlbumShare.setData(
        queryClient,
        { albumId: bridge.albumId },
        data,
      ),
  });

  const share = shareQuery.data;
  const absoluteUrl =
    share?.url && typeof window !== "undefined"
      ? new URL(share.url, window.location.origin).toString()
      : "";

  const copyLink = () => {
    if (absoluteUrl) void navigator.clipboard?.writeText(absoluteUrl);
  };

  return (
    <div className="flex h-full flex-col bg-surface-base text-fg-primary">
      <div className="flex-1 space-y-5 overflow-auto p-5">
        {shareQuery.isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spin />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-fg-primary">
                    链接分享
                  </h3>
                  <p className="text-xs text-fg-muted">
                    任何拥有链接的人都可以只读查看相册
                  </p>
                </div>
                <Button
                  size="small"
                  variant={share?.linkEnabled ? "default" : "primary"}
                  onClick={() =>
                    patchLinkMutation.mutate({
                      albumId: bridge.albumId,
                      enabled: !share?.linkEnabled,
                    })
                  }
                  loading={patchLinkMutation.isPending}
                  icon={<Link2 className="h-4 w-4" />}
                >
                  {share?.linkEnabled ? "关闭" : "开启"}
                </Button>
              </div>
              {share?.linkEnabled && absoluteUrl && (
                <div className="flex gap-2">
                  <Input value={absoluteUrl} readOnly className="flex-1" />
                  <Button
                    onClick={copyLink}
                    icon={<Copy className="h-4 w-4" />}
                  >
                    复制
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-fg-primary">
                  用户查看
                </h3>
                <p className="text-xs text-fg-muted">
                  v1 使用用户 UUID 添加只读访问
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="用户 UUID"
                  className="flex-1"
                />
                <Button
                  onClick={() =>
                    addUserMutation.mutate({
                      albumId: bridge.albumId,
                      userId: userId.trim(),
                    })
                  }
                  disabled={!userId.trim() || addUserMutation.isPending}
                  loading={addUserMutation.isPending}
                  icon={<UserPlus className="h-4 w-4" />}
                >
                  添加
                </Button>
              </div>
              {share?.users.length ? (
                <div className="space-y-1">
                  {share.users.map((entry) => (
                    <div
                      key={entry.userId}
                      className="flex items-center gap-2 rounded-lg bg-surface-raised px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {entry.userId}
                      </span>
                      <span className="text-xs text-fg-muted">只读</span>
                      <Button
                        size="small"
                        onClick={() =>
                          deleteUserMutation.mutate({
                            albumId: bridge.albumId,
                            userId: entry.userId,
                          })
                        }
                        icon={<Trash2 className="h-4 w-4" />}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="还没有指定用户分享" />
              )}
            </section>
          </>
        )}
      </div>
      <div className="flex justify-end border-t border-subtle p-4">
        <Button onClick={() => win.close()}>关闭</Button>
      </div>
    </div>
  );
}

export default function ShareAlbumWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (bridge?.kind !== "share-album") return null;

  return withProviders(
    bridge.ctx,
    queryClient,
    <ShareAlbumContent win={win} bridge={bridge} />,
  );
}
