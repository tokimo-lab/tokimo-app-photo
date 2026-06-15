import { useWindowActions, type WindowState } from "@tokimo/sdk";
import { useState } from "react";
import { queryClient } from "../index";
import { getBridge, type ModalBridge } from "../modal-bridge";
import { withProviders } from "../shared/providers";
import PhotoLibraryEditor from "./PhotoLibraryEditor";

type LibraryEditorBridge = Extract<ModalBridge, { kind: "library-editor" }>;

function PhotoLibraryEditorContent({
  win,
  bridge,
}: {
  win: WindowState;
  bridge: LibraryEditorBridge;
}) {
  const { closeWindow } = useWindowActions();
  const photoId =
    typeof win.metadata?.photoId === "string"
      ? win.metadata.photoId
      : undefined;

  return (
    <PhotoLibraryEditor
      photoId={photoId}
      onSaved={(savedId) => {
        bridge.onSaved?.(savedId);
        closeWindow(win.id);
      }}
      onDeleted={() => {
        bridge.onDeleted?.();
        closeWindow(win.id);
      }}
      onCancel={() => closeWindow(win.id)}
    />
  );
}

export default function PhotoLibraryEditorWindow({
  win,
}: {
  win: WindowState;
}) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (bridge?.kind !== "library-editor") return null;

  return withProviders(
    bridge.ctx,
    queryClient,
    <PhotoLibraryEditorContent win={win} bridge={bridge} />,
  );
}
