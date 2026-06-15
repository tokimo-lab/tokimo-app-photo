export type VfsType =
  | "local"
  | "nfs"
  | "smb"
  | "webdav"
  | "ftp"
  | "sftp"
  | "s3"
  | "aliyundrive"
  | "baidu_netdisk"
  | "quark"
  | "uc"
  | "115cloud"
  | "123pan"
  | "pikpak"
  | "thunder"
  | "139yun"
  | "189cloud"
  | "mopan"
  | "wopan"
  | "lanzou"
  | "google_drive"
  | "onedrive"
  | "dropbox"
  | "mega"
  | "terabox"
  | "yandex_disk";

export interface VfsConnection {
  id: string;
  name: string;
  type: VfsType;
  config?: Record<string, unknown> | null;
  sortOrder: number;
  lastScanAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VfsDisplayHints = {
  protocolPrefix?: string;
  rootPath?: string;
  icon?: string;
  label?: string;
};

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | null;
  modifiedAt?: string | null;
  mode?: string | null;
  owner?: string | null;
}

export interface FsStat {
  path: string;
  size: number | null;
  modifiedAt: string | null;
  mode: string | null;
}
