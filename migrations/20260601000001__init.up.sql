-- Photo app schema. Initial migration.

CREATE TABLE photo_libraries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'local',
    avatar          JSONB,
    description     TEXT,
    poster_path     TEXT,
    scrape_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    settings        JSONB,
    sources         JSONB NOT NULL DEFAULT '[]',
    sync_status     TEXT NOT NULL DEFAULT 'idle',
    last_sync_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- no cover_photo_id FK yet — added after photos is created (circular)
CREATE TABLE photo_albums (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id          UUID NOT NULL REFERENCES photo_libraries(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    cover_photo_id  UUID,
    album_type      TEXT NOT NULL DEFAULT 'manual',
    photo_count     INTEGER NOT NULL DEFAULT 0,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX photo_albums_app_id_idx ON photo_albums (app_id);

-- no avatar_face_id FK yet — added after photo_faces is created (circular)
CREATE TABLE photo_persons (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id          UUID NOT NULL REFERENCES photo_libraries(id) ON DELETE CASCADE,
    name            TEXT,
    avatar_face_id  INTEGER,
    face_count      INTEGER NOT NULL DEFAULT 0,
    is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX photo_persons_app_id_idx ON photo_persons (app_id);

CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id          UUID NOT NULL REFERENCES photo_libraries(id) ON DELETE CASCADE,
    source_id       UUID,
    filename        TEXT NOT NULL,
    path            TEXT NOT NULL,
    title           TEXT,
    description     TEXT,
    width           INTEGER,
    height          INTEGER,
    file_size       BIGINT,
    mime_type       TEXT,
    taken_at        TIMESTAMPTZ,
    camera_make     TEXT,
    camera_model    TEXT,
    lens_model      TEXT,
    focal_length    DOUBLE PRECISION,
    aperture        DOUBLE PRECISION,
    shutter_speed   TEXT,
    iso             INTEGER,
    orientation     INTEGER,
    exif_data       JSONB,
    gps_latitude    DOUBLE PRECISION,
    gps_longitude   DOUBLE PRECISION,
    gps_altitude    DOUBLE PRECISION,
    location_name   TEXT,
    geo_province    TEXT,
    geo_city        TEXT,
    geo_district    TEXT,
    geo_township    TEXT,
    geo_adcode      TEXT,
    geo_address     TEXT,
    thumbnail_path  TEXT,
    is_favorite     BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
    photo_album_id  UUID REFERENCES photo_albums(id) ON DELETE SET NULL,
    live_video_path TEXT,
    color_dominant  TEXT,
    ocr_scanned_at  TIMESTAMPTZ,
    ocr_debug_info  JSONB,
    deleted_at      TIMESTAMPTZ,
    checksum        TEXT,
    scanned_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (app_id, source_id, path)
);
CREATE INDEX photos_app_id_taken_at_idx ON photos (app_id, taken_at DESC NULLS LAST);
CREATE INDEX photos_app_id_album_idx   ON photos (app_id, photo_album_id);
CREATE INDEX photos_gps_idx            ON photos (gps_latitude, gps_longitude) WHERE gps_latitude IS NOT NULL;
CREATE INDEX photos_deleted_at_idx     ON photos (app_id) WHERE deleted_at IS NULL;

-- resolve albums ↔ photos circular FK
ALTER TABLE photo_albums ADD CONSTRAINT photo_albums_cover_photo_fk
    FOREIGN KEY (cover_photo_id) REFERENCES photos(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE photo_faces (
    id              SERIAL PRIMARY KEY,
    photo_id        UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    person_id       UUID REFERENCES photo_persons(id) ON DELETE SET NULL,
    x               DOUBLE PRECISION NOT NULL,
    y               DOUBLE PRECISION NOT NULL,
    w               DOUBLE PRECISION NOT NULL,
    h               DOUBLE PRECISION NOT NULL,
    confidence      DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX photo_faces_photo_id_idx  ON photo_faces (photo_id);
CREATE INDEX photo_faces_person_id_idx ON photo_faces (person_id);

-- resolve persons ↔ faces circular FK
ALTER TABLE photo_persons ADD CONSTRAINT photo_persons_avatar_face_fk
    FOREIGN KEY (avatar_face_id) REFERENCES photo_faces(id) ON DELETE SET NULL ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE photo_ocr_results (
    id              SERIAL PRIMARY KEY,
    photo_id        UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    x               DOUBLE PRECISION,
    y               DOUBLE PRECISION,
    w               DOUBLE PRECISION,
    h               DOUBLE PRECISION,
    angle           DOUBLE PRECISION NOT NULL DEFAULT 0,
    score           DOUBLE PRECISION,
    paragraph_id    INTEGER NOT NULL DEFAULT 0,
    char_positions  JSONB,
    model_name      TEXT NOT NULL DEFAULT '',
    positioning_type TEXT NOT NULL DEFAULT 'box',
    corners         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX photo_ocr_results_photo_id_idx ON photo_ocr_results (photo_id);

CREATE TABLE photo_clip_vectors (
    id              SERIAL PRIMARY KEY,
    photo_id        UUID NOT NULL UNIQUE REFERENCES photos(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE photo_geo_cache (
    id              SERIAL PRIMARY KEY,
    lat_key         TEXT NOT NULL,
    lon_key         TEXT NOT NULL,
    province        TEXT,
    city            TEXT,
    district        TEXT,
    township        TEXT,
    adcode          TEXT,
    address         TEXT,
    country         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lat_key, lon_key)
);

