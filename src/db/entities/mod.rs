// Photo-specific entities
pub mod photo_albums;
pub mod photo_album_user_shares;
pub mod photo_clip_vectors;
pub mod photo_faces;
pub mod photo_geo_cache;
pub mod photo_libraries;
pub mod photo_ocr_results;
pub mod photo_persons;
pub mod photos;

// Shared entities (jobs, vfs, system_config)
pub mod jobs;
pub mod system_config;
pub mod vfs;

// Cross-domain entities referenced by app_sync
pub mod book_chapters;
pub mod book_files;
pub mod book_items;
pub mod book_volumes;
pub mod books;
pub mod music_album_artists;
pub mod music_albums;
pub mod music_artists;
pub mod music_files;
pub mod music_tracks;
pub mod musics;
