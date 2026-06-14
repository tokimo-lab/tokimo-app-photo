import { AppSidebar, CircularProgress, Tooltip } from "@tokimo/ui";
import { PanelLeft, PanelLeftClose, Plus, Settings } from "lucide-react";
import type { PhotoLibraryOutput } from "../generated/rust-api";
import { getAvatarColor, getAvatarIcon } from "../shared/avatar-utils";
import { AppIcon } from "../shared/components/icons";

export default function PhotoSidebar({
  libraries,
  activeId,
  onSelect,
  collapsed,
  onCreateClick,
  onSettingsClick,
  syncProgress,
  onToggleCollapse,
  settingsActive = false,
}: {
  libraries: PhotoLibraryOutput[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
  onCreateClick: () => void;
  onSettingsClick: () => void;
  syncProgress?: Record<string, { isActive: boolean; pct: number }>;
  onToggleCollapse?: () => void;
  /** When true, the settings (⚙) button shows a highlighted state. */
  settingsActive?: boolean;
}) {
  const sections = [
    {
      items: libraries.map((lib) => {
        const sp = syncProgress?.[lib.id];
        return {
          key: lib.id,
          icon: (
            <AppIcon
              icon={getAvatarIcon(lib.avatar) || lib.name}
              color={getAvatarColor(lib.avatar)}
              size={24}
            />
          ),
          collapsedIcon: sp?.isActive ? (
            <span className="relative flex h-8 w-8 items-center justify-center">
              <AppIcon
                icon={getAvatarIcon(lib.avatar)}
                color={getAvatarColor(lib.avatar)}
                size={24}
              />
              <CircularProgress
                value={sp.pct}
                size={32}
                strokeWidth={2}
                showText={false}
                className="absolute left-0 top-0"
              />
            </span>
          ) : undefined,
          label: lib.name,
          extra: (() => {
            if (sp?.isActive) {
              return <CircularProgress value={sp.pct} size={24} />;
            }
            if (collapsed) return undefined;
            return lib.itemCount > 0 ? (
              <span className="text-[10px] tabular-nums text-fg-muted">
                {lib.itemCount}
              </span>
            ) : undefined;
          })(),
        };
      }),
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
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition-all ${
            settingsActive
              ? "bg-black/[0.08] text-fg-primary dark:bg-white/[0.08]"
              : "text-fg-muted hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
          }`}
        >
          <Settings className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip title="展开侧边栏" placement="right">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <PanelLeft className="h-4 w-4" />
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
          className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-all ${
            settingsActive
              ? "bg-black/[0.08] text-fg-primary dark:bg-white/[0.08]"
              : "text-fg-muted hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
          }`}
        >
          <Settings className="h-4 w-4" />
        </button>
      </Tooltip>
      <Tooltip title="收起侧边栏">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-all hover:bg-black/[0.08] hover:text-fg-secondary dark:hover:bg-white/[0.08]"
        >
          <PanelLeftClose className="h-4 w-4" />
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
