import { useWindowActions, type WindowState } from "@tokimo/sdk";
import { Button, Input } from "@tokimo/ui";
import { useState } from "react";
import { queryClient } from "../index";
import { getBridge, type ModalBridge } from "../modal-bridge";
import { api } from "../generated/rust-api";
import { withProviders } from "../shared/providers";

type CreateAlbumBridge = Extract<ModalBridge, { kind: "create-album" }>;

function CreateAlbumContent({
  win,
  bridge,
}: {
  win: WindowState;
  bridge: CreateAlbumBridge;
}) {
  const { closeWindow } = useWindowActions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = api.photo.createPhotoAlbum.useMutation({
    onSuccess: () => {
      bridge.onCreated?.();
      closeWindow(win.id);
    },
  });

  const handleCreate = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    createMutation.mutate({
      id: bridge.appId,
      name: trimmedName,
      description: description.trim() || undefined,
    });
  };

  return (
    <div className="flex h-full flex-col bg-surface-base p-5 text-fg-primary">
      <div className="flex-1 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-secondary">
            名称
          </span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                handleCreate();
              }
            }}
            className="w-full"
            placeholder="输入相册名称"
            size="large"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-secondary">
            描述（可选）
          </span>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-none"
            placeholder="描述一下这个相册"
            rows={4}
          />
        </label>
      </div>
      <div className="flex justify-end gap-3 pt-3">
        <Button
          onClick={() => closeWindow(win.id)}
          disabled={createMutation.isPending}
        >
          取消
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={!name.trim() || createMutation.isPending}
          loading={createMutation.isPending}
        >
          创建
        </Button>
      </div>
    </div>
  );
}

export default function CreateAlbumWindow({ win }: { win: WindowState }) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (bridge?.kind !== "create-album") return null;

  return withProviders(
    bridge.ctx,
    queryClient,
    <CreateAlbumContent win={win} bridge={bridge} />,
  );
}
