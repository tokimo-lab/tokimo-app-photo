use serde::Serialize;

pub const PHOTO_EXTENSIONS: [&str; 22] = [
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif", ".heic", ".heif", ".avif", ".raw", ".cr2",
    ".cr3", ".nef", ".arw", ".dng", ".orf", ".rw2", ".pef", ".srw", ".raf",
];

/// Video extensions used for Live Photo companion detection.
#[allow(dead_code)]
pub const VIDEO_EXTENSIONS: [&str; 4] = [".mov", ".mp4", ".m4v", ".avi"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub file_path: String,
    pub dir_path: String,
    pub file_size: u64,
    pub mtime: i64,
}

pub struct WalkProgress {
    pub visited_dirs: usize,
    pub found_files: usize,
}

/// Final statistics returned after a walk completes.
#[derive(Debug, Clone)]
pub struct WalkStats {
    pub visited_dirs: usize,
    pub found_files: usize,
}
