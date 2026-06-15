import { cn, Input, Popover, Tabs } from "@tokimo/ui";
import { ImagePlus, Pencil, Smile, Type, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { authFetch } from "../../lib/auth-fetch";
import { rustUrl } from "../../lib/rust-api-runtime";
import { storageUrl } from "../../lib/storage-url";
import { AppIcon } from "../../shared/components/icons";
import type { AvatarData } from "../../types/avatar";
import { EmojiGrid } from "./EmojiGrid";
import { IconGrid } from "./IconGrid";

const PRESET_COLORS = [
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#78716c",
  "#1e293b",
];

const DEFAULT_COLOR = "#3b82f6";

interface AvatarPickerProps {
  value: AvatarData | null;
  onChange: (value: AvatarData | null) => void;
  size?: number;
  /** Placeholder icon name (lucide:xxx format) when value is null */
  placeholder?: string;
}

/** Get the current color from AvatarData, or fallback */
function currentColor(value: AvatarData | null): string {
  if (!value) return DEFAULT_COLOR;
  if (value.type === "text" || value.type === "icon") return value.color;
  return DEFAULT_COLOR;
}

/** Get the icon string for AppIcon rendering */
function toIconString(value: AvatarData | null): string | undefined {
  if (!value) return undefined;
  if (value.type === "icon") return value.icon;
  if (value.type === "text") return value.text;
  return undefined;
}

/** Get the color string for AppIcon rendering */
function toColorString(value: AvatarData | null): string | undefined {
  if (!value) return undefined;
  if (value.type === "text" || value.type === "icon") return value.color;
  return undefined;
}

async function uploadIconFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await authFetch(rustUrl("/api/storage/upload/icon"), {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Upload failed");
  }
  const json = (await res.json()) as {
    success: boolean;
    data: { key: string };
  };
  return json.data.key;
}

export function AvatarPicker({
  value,
  onChange,
  size = 40,
  placeholder,
}: AvatarPickerProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const color = currentColor(value);

  const handleColorSelect = useCallback(
    (c: string) => {
      if (!value || value.type === "image") {
        onChange({ type: "icon", icon: placeholder ?? "", color: c });
        return;
      }
      onChange({ ...value, color: c });
    },
    [value, onChange, placeholder],
  );

  const handleTextChange = useCallback(
    (text: string) => {
      onChange({ type: "text", text, color });
    },
    [onChange, color],
  );

  const handleIconSelect = useCallback(
    (name: string) => {
      onChange({ type: "icon", icon: `lucide:${name}`, color });
    },
    [onChange, color],
  );

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      onChange({ type: "text", text: emoji, color });
    },
    [onChange, color],
  );

  const handleClear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const key = await uploadIconFile(file);
        onChange({ type: "image", src: key });
      } catch {
        // silently fail — could add toast later
      } finally {
        setUploading(false);
      }
    },
    [onChange],
  );

  const textValue = value?.type === "text" ? value.text : "";

  const previewNode =
    value?.type === "image" ? (
      <img
        src={storageUrl(value.src)}
        alt="avatar"
        className="h-16 w-16 rounded-[20%] object-cover"
      />
    ) : (
      <AppIcon
        icon={toIconString(value) || placeholder}
        color={toColorString(value)}
        size={64}
      />
    );

  const panel = (
    <div className="flex flex-col gap-3 p-3">
      {/* Live preview + clear */}
      <div className="flex items-center justify-between">
        {previewNode}
        <button
          type="button"
          className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-fill-tertiary hover:text-fg-primary"
          onClick={handleClear}
        >
          <X className="h-3 w-3" />
          清除
        </button>
      </div>

      {/* Color palette */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-fg-muted">背景色</div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                "h-6 w-6 cursor-pointer rounded-full border-2 transition-all",
                color === c
                  ? "scale-110 border-gray-800 shadow-md dark:border-white"
                  : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: c }}
              onClick={() => handleColorSelect(c)}
            />
          ))}
          {/* No background color */}
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-2 transition-all",
              "bg-fill-tertiary dark:bg-white/10",
              color === "transparent"
                ? "scale-110 border-gray-800 shadow-md dark:border-white"
                : "border-border-base hover:scale-110",
            )}
            onClick={() => handleColorSelect("transparent")}
          >
            <span className="block h-[1.5px] w-3.5 -rotate-45 rounded-full bg-red-400" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        size="small"
        defaultActiveKey="icon"
        items={[
          {
            key: "text",
            label: (
              <span className="flex items-center gap-1">
                <Type className="h-3.5 w-3.5" />
                文字
              </span>
            ),
            children: (
              <div className="flex flex-col gap-2 pt-2">
                <Input
                  value={textValue}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="输入文字或 emoji"
                  maxLength={8}
                  size="small"
                />
                <p className="text-xs text-fg-muted">
                  最多 4 个汉字或 8 个英文字符
                </p>
              </div>
            ),
          },
          {
            key: "emoji",
            label: (
              <span className="flex items-center gap-1">
                <Smile className="h-3.5 w-3.5" />
                表情
              </span>
            ),
            children: (
              <div className="pt-2">
                <EmojiGrid
                  selected={value?.type === "text" ? value.text : ""}
                  onSelect={handleEmojiSelect}
                />
              </div>
            ),
          },
          {
            key: "icon",
            label: (
              <span className="flex items-center gap-1">
                <span className="text-sm">⊞</span>
                图标
              </span>
            ),
            children: (
              <div className="pt-2">
                <IconGrid
                  selected={value?.type === "icon" ? value.icon : ""}
                  onSelect={handleIconSelect}
                />
              </div>
            ),
          },
          {
            key: "upload",
            label: (
              <span className="flex items-center gap-1">
                <Upload className="h-3.5 w-3.5" />
                上传
              </span>
            ),
            children: (
              <div className="pt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadFile(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-8 transition-colors",
                    dragOver
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-border-base hover:border-fg-muted",
                    uploading && "pointer-events-none opacity-50",
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleUploadFile(file);
                  }}
                >
                  <Upload className="h-8 w-8 text-fg-muted" />
                  <p className="text-sm text-fg-muted">
                    {uploading ? "上传中..." : "点击或拖拽图片到这里"}
                  </p>
                  <p className="text-xs text-fg-muted">
                    支持 JPG、PNG、WebP，建议正方形
                  </p>
                </button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );

  const hasAvatar = !!toIconString(value) || value?.type === "image";

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      content={panel}
      popupClassName="w-[380px] border border-black/[0.06] dark:border-white/[0.08] shadow-lg bg-white/90 dark:bg-[rgba(15,15,25,0.9)]"
      open={open}
      onOpenChange={setOpen}
    >
      <button type="button" className="group relative w-fit cursor-pointer">
        {hasAvatar ? (
          value?.type === "image" ? (
            <img
              src={storageUrl(value.src)}
              alt="avatar"
              className="rounded-[20%] object-cover"
              style={{ width: size, height: size }}
            />
          ) : (
            <AppIcon
              icon={toIconString(value)}
              color={toColorString(value)}
              size={size}
            />
          )
        ) : (
          <div
            className="flex items-center justify-center rounded-[20%] bg-fill-tertiary"
            style={{ width: size, height: size }}
          >
            <ImagePlus
              className="text-fg-muted"
              style={{ width: size * 0.4, height: size * 0.4 }}
            />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[20%] bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <Pencil
            className="text-white"
            style={{ width: size * 0.25, height: size * 0.25 }}
          />
        </div>
      </button>
    </Popover>
  );
}
