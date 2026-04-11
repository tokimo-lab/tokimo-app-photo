import { AppSidebar, CircularProgress, Tooltip } from "@tokiomo/components";
import { Plus, Settings } from "lucide-react";
import type { PhotoLibraryOutput } from "@/generated/rust-api";
import { AppIcon } from "@/shared/components/icons";

export default function PhotoSidebar({
  libraries,
  activeId,
  onSelect,
  collapsed,
  onCreateClick,
  onSettingsClick,
  syncProgress,
}: {
  libraries: PhotoLibraryOutput[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
  onCreateClick: () => void;
  onSettingsClick: () => void;
  syncProgress?: Record<string, { isActive: boolean; pct: number }>;
}) {
  const sections = [
    {
      items: libraries.map((lib) => ({
        key: lib.id,
        icon: <AppIcon icon={lib.icon} color={lib.color} size={20} />,
        label: lib.name,
        extra: (() => {
          const sp = syncProgress?.[lib.id];
          if (sp?.isActive) {
            return <CircularProgress value={sp.pct} size={24} />;
          }
          return lib.itemCount > 0 ? (
            <span className="text-[10px] tabular-nums text-fg-muted">
              {lib.itemCount}
            </span>
          ) : undefined;
        })(),
      })),
    },
  ];

  const collapsedFooter = (
    <div className="flex flex-col items-center gap-1">
      <Tooltip title="新建图库" placement="right">
        <button
          type="button"
          onClick={onCreateClick}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip title="图库设置" placement="right">
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <Settings className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );

  const fullFooter = (
    <div className="flex items-center gap-1">
      <Tooltip title="新建图库">
        <button
          type="button"
          onClick={onCreateClick}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip title="图库设置">
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <Settings className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <AppSidebar
      sections={sections}
      activeKey={activeId ?? undefined}
      onSelect={onSelect}
      collapsed={collapsed}
      footer={collapsed ? collapsedFooter : fullFooter}
    />
  );
}
