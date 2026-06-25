import type { ShellWindowHandle } from "@tokimo/sdk";
import { Button, Empty, Input, SegmentedControl, Spin } from "@tokimo/ui";
import { CheckCircle2, FolderOpen, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { queryClient } from "../index";
import { getBridge, type ModalBridge } from "../modal-bridge";
import { api, type PhotoAlbumSourceInput } from "../generated/rust-api";
import { thumbUrl } from "../lib/thumb";
import { withProviders } from "../shared/providers";

type CreateAlbumBridge = Extract<ModalBridge, { kind: "create-album" }>;
type Mode = "manual" | "auto";
type SourceKind = "person" | "folder" | "clip";

interface SelectedSource {
  kind: SourceKind;
  ref: string;
  label: string;
}

function CreateAlbumContent({
  win,
  bridge,
}: {
  win: ShellWindowHandle;
  bridge: CreateAlbumBridge;
}) {
  const [mode, setMode] = useState<Mode>("manual");
  const [sourceKind, setSourceKind] = useState<SourceKind>("person");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(
    null,
  );
  const [clipQuery, setClipQuery] = useState("");

  const personsQuery = api.photo.listPersons.useQuery(
    { id: bridge.appId },
    { enabled: mode === "auto" && sourceKind === "person" },
  );
  const foldersQuery = api.photo.listPhotoFolders.useQuery(
    { id: bridge.appId, path: "/" },
    { enabled: mode === "auto" && sourceKind === "folder" },
  );

  const effectiveName = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed) return trimmed;
    if (mode === "auto" && selectedSource) return selectedSource.label;
    return "";
  }, [mode, name, selectedSource]);

  const createMutation = api.photo.createPhotoAlbum.useMutation({
    onSuccess: () => {
      bridge.onCreated?.();
      win.close();
    },
  });

  const handleCreate = () => {
    const trimmedName = effectiveName.trim();
    if (!trimmedName) return;
    let source: PhotoAlbumSourceInput | undefined;
    if (mode === "auto") {
      const finalSource =
        sourceKind === "clip" && clipQuery.trim()
          ? { kind: "clip" as const, ref: clipQuery.trim(), label: clipQuery.trim() }
          : selectedSource;
      if (!finalSource) return;
      source = {
        kind: finalSource.kind,
        ref: finalSource.ref,
        label: finalSource.label,
      };
    }
    createMutation.mutate({
      id: bridge.appId,
      name: trimmedName,
      description: description.trim() || undefined,
      source,
    });
  };

  const createDisabled =
    createMutation.isPending ||
    !effectiveName.trim() ||
    (mode === "auto" &&
      !(sourceKind === "clip" ? clipQuery.trim() : selectedSource));

  return (
    <div className="flex h-full flex-col bg-surface-base text-fg-primary">
      <div className="flex-1 space-y-4 overflow-auto p-5">
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as Mode)}
          options={[
            { label: "手动相册", value: "manual" },
            { label: "自动更新", value: "auto" },
          ]}
        />

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
            placeholder={
              mode === "auto" && selectedSource
                ? selectedSource.label
                : "输入相册名称"
            }
            size="large"
            autoFocus
          />
        </label>

        {mode === "auto" && (
          <div className="space-y-3">
            <SegmentedControl
              value={sourceKind}
              onChange={(value) => {
                setSourceKind(value as SourceKind);
                setSelectedSource(null);
              }}
              options={[
                { label: "人物", value: "person" },
                { label: "标签", value: "clip" },
                { label: "文件夹", value: "folder" },
              ]}
            />
            {sourceKind === "person" && (
              <PersonSourcePicker
                selected={selectedSource}
                persons={personsQuery.data ?? []}
                isLoading={personsQuery.isLoading}
                onSelect={setSelectedSource}
              />
            )}
            {sourceKind === "folder" && (
              <FolderSourcePicker
                selected={selectedSource}
                folders={foldersQuery.data?.folders ?? []}
                isLoading={foldersQuery.isLoading}
                onSelect={setSelectedSource}
              />
            )}
            {sourceKind === "clip" && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-fg-secondary">
                  标签 / 描述
                </span>
                <Input
                  value={clipQuery}
                  onChange={(e) => setClipQuery(e.target.value)}
                  placeholder="例如：海边、猫、夜景"
                />
              </label>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg-secondary">
            描述（可选）
          </span>
          <Input.TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="resize-none"
            placeholder="描述一下这个相册"
            rows={3}
          />
        </label>
      </div>
      <div className="flex justify-end gap-3 border-t border-subtle p-4">
        <Button
          onClick={() => win.close()}
          disabled={createMutation.isPending}
        >
          取消
        </Button>
        <Button
          variant="primary"
          onClick={handleCreate}
          disabled={createDisabled}
          loading={createMutation.isPending}
        >
          创建
        </Button>
      </div>
    </div>
  );
}

function PersonSourcePicker({
  selected,
  persons,
  isLoading,
  onSelect,
}: {
  selected: SelectedSource | null;
  persons: Array<{
    id: string;
    name: string | null;
    faceCount: number;
    avatarPhotoId: string | null;
    avatarThumbnailPath: string | null;
  }>;
  isLoading: boolean;
  onSelect: (source: SelectedSource) => void;
}) {
  if (isLoading) return <PickerLoading />;
  if (persons.length === 0) return <Empty description="暂无人物" />;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
      {persons.map((person) => {
        const label = person.name || "未命名人物";
        const active = selected?.kind === "person" && selected.ref === person.id;
        return (
          <button
            key={person.id}
            type="button"
            className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center transition ${
              active
                ? "border-accent bg-accent-subtle text-accent-text"
                : "border-base bg-surface-raised hover:bg-surface-overlay-hover"
            }`}
            onClick={() =>
              onSelect({ kind: "person", ref: person.id, label })
            }
          >
            {active && (
              <CheckCircle2 className="absolute right-2 top-2 h-4 w-4" />
            )}
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-fill-tertiary">
              {person.avatarPhotoId ? (
                <img
                  src={thumbUrl("photo", person.avatarPhotoId, 120)}
                  alt={label}
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserRound className="h-6 w-6 text-fg-muted" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{label}</p>
              <p className="text-xs text-fg-muted">{person.faceCount} 张</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FolderSourcePicker({
  selected,
  folders,
  isLoading,
  onSelect,
}: {
  selected: SelectedSource | null;
  folders: Array<{
    name: string;
    path: string;
    photoCount: number;
    coverPhotoId: string | null;
  }>;
  isLoading: boolean;
  onSelect: (source: SelectedSource) => void;
}) {
  if (isLoading) return <PickerLoading />;
  if (folders.length === 0) return <Empty description="暂无文件夹" />;
  return (
    <div className="space-y-1">
      {folders.map((folder) => {
        const active = selected?.kind === "folder" && selected.ref === folder.path;
        return (
          <button
            key={folder.path}
            type="button"
            className={`flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
              active
                ? "border-accent bg-accent-subtle text-accent-text"
                : "border-transparent bg-surface-raised hover:bg-surface-overlay-hover"
            }`}
            onClick={() =>
              onSelect({
                kind: "folder",
                ref: folder.path,
                label: folder.name,
              })
            }
          >
            <FolderOpen className="h-4 w-4 text-fg-muted" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {folder.name}
            </span>
            <span className="text-xs text-fg-muted">{folder.photoCount} 张</span>
            {active && <CheckCircle2 className="h-4 w-4" />}
          </button>
        );
      })}
    </div>
  );
}

function PickerLoading() {
  return (
    <div className="flex h-32 items-center justify-center">
      <Spin />
    </div>
  );
}

export default function CreateAlbumWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
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
