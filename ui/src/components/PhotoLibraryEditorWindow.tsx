import { useWindowActions } from "@tokimo/sdk";
import type { ShellWindowHandle } from "@tokimo/sdk";
import PhotoLibraryEditor from "./PhotoLibraryEditor";

export default function PhotoLibraryEditorWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
  const meta = win.metadata as Record<string, unknown>;
  const photoId = meta.photoId as string | undefined;
  const onSaved = meta.onSaved as ((id: string) => void) | undefined;

  return (
    <PhotoLibraryEditor
      photoId={photoId}
      onSaved={(id) => {
        onSaved?.(id);
        win.close();
      }}
      onDeleted={() => win.close()}
      onCancel={() => win.close()}
    />
  );
}
