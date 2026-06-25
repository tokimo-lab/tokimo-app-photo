ALTER TABLE photo_albums
  ADD COLUMN IF NOT EXISTS owner_user_id UUID,
  ADD COLUMN IF NOT EXISTS source_ref TEXT,
  ADD COLUMN IF NOT EXISTS source_label TEXT,
  ADD COLUMN IF NOT EXISTS source_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS photo_album_user_shares (
  id UUID PRIMARY KEY,
  album_id UUID NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  permission TEXT NOT NULL DEFAULT 'view',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT photo_album_user_shares_permission_check CHECK (permission IN ('view')),
  CONSTRAINT photo_album_user_shares_album_user_key UNIQUE (album_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_photo_albums_owner_user_id
  ON photo_albums(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_photo_album_user_shares_user_id
  ON photo_album_user_shares(user_id);

CREATE INDEX IF NOT EXISTS idx_photo_album_user_shares_album_id
  ON photo_album_user_shares(album_id);
