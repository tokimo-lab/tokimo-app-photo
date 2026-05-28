import { useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Spin } from "@tokimo/ui";
import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAppCtx } from "../AppContext";
import { api } from "../generated/rust-api";
import type { PhotoLibraryOutput } from "../lib/types";
import type { WindowState } from "../system/window/window-types";

interface DraftSource {
  sourceId: string;
  rootPath: string;
  sourceName?: string | null;
  sourceType?: string | null;
}

function sourceLabel(source: DraftSource): string {
  return source.sourceName || source.rootPath || source.sourceId;
}

function LibraryRow({ library }: { library: PhotoLibraryOutput }) {
  const qc = useQueryClient();
  const deleteMutation = api.photo.delete.useMutation({
    onSuccess: () => api.photo.list.invalidate(qc),
  });
  return (
    <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-bg-secondary px-4 py-3">
      <div>
        <div className="font-medium text-fg-primary">{library.name}</div>
        <div className="mt-1 text-xs text-fg-muted">
          {library.sources.map((s) => s.rootPath).join(" · ") || "未绑定来源"}
        </div>
      </div>
      <button
        type="button"
        className="cursor-pointer rounded-lg p-2 text-fg-muted hover:bg-red-500/10 hover:text-red-500"
        onClick={() => {
          if (window.confirm(`删除图库“${library.name}”？`)) {
            deleteMutation.mutate(library.id);
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function PhotoSettingsWindow(_: { win: WindowState }) {
  const ctx = useAppCtx();
  const qc = useQueryClient();
  const { data: libraries, isLoading } = api.photo.list.useQuery();
  const [name, setName] = useState("");
  const [source, setSource] = useState<DraftSource | null>(null);
  const createMutation = api.photo.create.useMutation({
    onSuccess: () => {
      setName("");
      setSource(null);
      api.photo.list.invalidate(qc);
    },
  });

  const pickSource = async () => {
    const picked = await ctx.shell.pickStorageBinding({ title: "选择照片目录" });
    if (!picked) return;
    setSource({
      sourceId: picked.sourceId,
      rootPath: picked.path,
      sourceName: picked.sourceName,
      sourceType: picked.sourceType,
    });
    if (!name.trim()) setName(picked.sourceName || "照片图库");
  };

  const createLibrary = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({
      name: trimmed,
      type: "photo",
      avatar: { type: "icon", icon: "Image", color: "#10b981" },
      scrapeEnabled: true,
      sources: source
        ? [
            {
              sourceId: source.sourceId,
              rootPath: source.rootPath,
              sortOrder: 0,
              isDefaultDownload: false,
            },
          ]
        : [],
    });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto bg-bg-primary p-6 text-fg-primary">
      <section className="rounded-2xl border border-border-subtle bg-bg-secondary/60 p-4">
        <h2 className="text-base font-semibold">新建图库</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="图库名称"
            className="rounded-lg border border-border-subtle bg-bg-primary px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
          <Button onClick={pickSource} icon={<FolderOpen className="h-4 w-4" />}>
            选择目录
          </Button>
        </div>
        <div className="mt-3 text-sm text-fg-muted">
          {source ? `已选择：${sourceLabel(source)}` : "可先创建空图库，稍后再绑定来源。"}
        </div>
        <div className="mt-4">
          <Button
            variant="primary"
            disabled={!name.trim()}
            loading={createMutation.isPending}
            onClick={createLibrary}
            icon={<Plus className="h-4 w-4" />}
          >
            创建图库
          </Button>
        </div>
      </section>

      <section className="min-h-0 flex-1">
        <h2 className="mb-3 text-base font-semibold">图库列表</h2>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center"><Spin /></div>
        ) : libraries && libraries.length > 0 ? (
          <div className="space-y-3">
            {libraries.map((library) => <LibraryRow key={library.id} library={library} />)}
          </div>
        ) : (
          <Empty description="暂无图库" />
        )}
      </section>
    </div>
  );
}
