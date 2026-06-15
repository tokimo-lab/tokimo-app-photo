/** Avatar data stored as JSONB in the database */
export type AvatarData =
  | { type: "text"; text: string; color: string }
  | { type: "icon"; icon: string; color: string }
  | { type: "image"; src: string };
