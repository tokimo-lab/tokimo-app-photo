/**
 * Rust 后端 base URL — dev 环境从 RUST_SERVER 读取（如 `http://localhost:5678`），
 * 生产环境为空字符串（同源部署，API 直接用相对路径）。末尾不含斜杠。
 */
export const DEV_SERVER: string = import.meta.env.DEV
  ? ((import.meta.env as Record<string, string>).RUST_SERVER ?? "").replace(
      /\/$/,
      "",
    )
  : "";

/**
 * DEV_SERVER 的 WebSocket 版本（`ws://` / `wss://`）。
 * DEV_SERVER 为空时回退到 window.location.origin。
 */
export function devWsBase(): string {
  const base = DEV_SERVER || window.location.origin;
  return base.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}
