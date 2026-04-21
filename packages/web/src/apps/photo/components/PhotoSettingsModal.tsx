import { Modal, Spin } from "@tokimo/ui";
import { lazy, Suspense } from "react";

const PhotoSettingsPage = lazy(
  () => import("@/apps/settings/admin/PhotoSettingsPage"),
);

interface PhotoSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function PhotoSettingsModal({
  open,
  onClose,
}: PhotoSettingsModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="TokimoPhoto 设置"
      footer={null}
      width={960}
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      <div className="h-[640px]">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spin />
            </div>
          }
        >
          <PhotoSettingsPage />
        </Suspense>
      </div>
    </Modal>
  );
}
