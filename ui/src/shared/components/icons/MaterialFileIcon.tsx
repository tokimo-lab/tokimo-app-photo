import { memo } from "react";
import { getMaterialIcon } from "./material-file-icon";

/**
 * Renders a material-design file/folder icon.
 * Replaces duplicated getMaterialIcon + render logic scattered across
 * FileItem, FileBreadcrumb, FileBrowserList, OrganizeItemList, and window-icon.
 */
export const MaterialFileIcon = memo(function MaterialFileIcon({
  name,
  isDirectory = false,
  size = 14,
}: {
  name: string;
  isDirectory?: boolean;
  size?: number;
}) {
  const { url, isDefault } = getMaterialIcon(name, isDirectory);

  if (isDefault) {
    return (
      <span
        className="shrink-0 inline-block"
        style={{
          width: size,
          height: size,
          backgroundColor: "var(--color-accent)",
          mask: `url(${url}) center/contain no-repeat`,
          WebkitMask: `url(${url}) center/contain no-repeat`,
        }}
      />
    );
  }

  return (
    <img src={url} alt="" width={size} height={size} className="shrink-0" />
  );
});
