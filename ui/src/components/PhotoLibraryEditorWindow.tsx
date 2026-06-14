/**
 * Photo Library Editor Window — standalone stub.
 *
 * In the shell this is a full settings/admin window. In standalone mode
 * we provide a minimal placeholder so the dynamic import in PhotoApp
 * resolves without error.
 */

export default function PhotoLibraryEditorWindow() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-neutral-500">
      图库编辑器在独立模式下不可用
    </div>
  );
}
