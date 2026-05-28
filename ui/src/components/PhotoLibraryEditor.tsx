import { useQueryClient } from "@tanstack/react-query";
import {
  type AvatarData,
  AvatarPicker,
  Button,
  Form,
  type FormInstance,
  Input,
  Modal,
  parseAvatar,
  ScrollArea,
  Select,
  SettingGroup,
  SettingRow,
  type StorageBinding,
  StorageBindingsField,
  Switch,
  useToast,
} from "@tokimo/ui";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { PhotoLibraryOutput } from "../lib/types";
import PhotoReprocessTools from "./PhotoReprocessTools";

const PHOTO_TYPES = [
  { value: "photo", label: "照片" },
  { value: "screenshot", label: "截图" },
] as const;

interface PhotoLibraryEditorProps {
  photoId?: string;
  onSaved?: (savedId: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}

export default function PhotoLibraryEditor({
  photoId,
  onSaved,
  onDeleted,
  onCancel,
}: PhotoLibraryEditorProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data: libraries = [] } = api.photo.list.useQuery();
  const { data: vfsSources = [] } = api.vfs.list.useQuery();
  const library = photoId ? libraries.find((c) => c.id === photoId) : undefined;

  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [bindings, setBindings] = useState<StorageBinding[]>([]);

  const prevId = useRef(photoId);
  useEffect(() => {
    if (prevId.current !== photoId) {
      prevId.current = photoId;
      setDeleteOpen(false);
      setDeleteInput("");
    }
  }, [photoId]);

  useEffect(() => {
    if (library) {
      const settings =
        (library.settings as Record<string, unknown> | null) ?? {};
      form.setFieldsValue({
        type: library.type,
        name: library.name,
        description: library.description ?? "",
        autoOcr: (settings.autoOcr as boolean | undefined) ?? true,
        autoClip: (settings.autoClip as boolean | undefined) ?? true,
        autoFace: (settings.autoFace as boolean | undefined) ?? true,
        autoGeo: (settings.autoGeo as boolean | undefined) ?? true,
      });
      setAvatar(parseAvatar(library.avatar));
      setBindings(
        library.sources.map((s) => ({
          sourceId: s.sourceId,
          rootPath: s.rootPath,
          isDefaultDownload: s.isDefaultDownload,
        })),
      );
    } else {
      form.resetFields();
      form.setFieldsValue({
        type: "photo",
        autoOcr: true,
        autoClip: true,
        autoFace: true,
        autoGeo: true,
      });
      setAvatar({ type: "icon", icon: "lucide:camera", color: "#8b5cf6" });
      setBindings([]);
    }
  }, [library, form]);

  const createMutation = api.photo.create.useMutation({
    onSuccess: (created) => {
      toast.success("图库已创建");
      api.photo.list.invalidate(qc);
      onSaved?.(created.id);
    },
    onError: (e) => toast.error(e.message || "创建失败"),
  });

  const updateMutation = api.photo.update.useMutation({
    onSuccess: (_data, variables) => {
      toast.success("已保存");
      api.photo.list.invalidate(qc);
      onSaved?.(variables.id);
    },
    onError: (e) => toast.error(e.message || "保存失败"),
  });

  const deleteMutation = api.photo.delete.useMutation({
    onSuccess: () => {
      toast.success("图库已删除");
      api.photo.list.invalidate(qc);
      setDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => toast.error(e.message || "删除失败"),
  });

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    const sources = bindings
      .filter((b) => b.sourceId && b.rootPath)
      .map((b, i) => ({
        sourceId: b.sourceId,
        rootPath: b.rootPath,
        sortOrder: i,
        isDefaultDownload: b.isDefaultDownload ?? i === 0,
      }));

    const existingSettings =
      (library?.settings as Record<string, unknown> | null) ?? {};
    const mergedSettings: Record<string, unknown> = {
      ...existingSettings,
      autoOcr: values.autoOcr as boolean,
      autoClip: values.autoClip as boolean,
      autoFace: values.autoFace as boolean,
      autoGeo: values.autoGeo as boolean,
    };

    if (library) {
      await updateMutation.mutateAsync({
        id: library.id,
        name: values.name as string,
        avatar: avatar as Record<string, unknown> | null,
        description: (values.description as string) || null,
        settings: mergedSettings,
        sources,
      });
    } else {
      await createMutation.mutateAsync({
        name: values.name as string,
        type: (values.type as string) || "photo",
        avatar: avatar as Record<string, unknown> | null,
        description: (values.description as string) || null,
        settings: mergedSettings,
        sources,
      });
    }
  }, [form, library, avatar, bindings, createMutation, updateMutation]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Form
        form={form as FormInstance}
        layout="vertical"
        autoComplete="off"
        className="flex min-h-0 flex-1 flex-col"
      >
        <ScrollArea
          direction="vertical"
          className="min-h-0 flex-1"
          innerClassName="space-y-5 px-5 py-5"
        >
          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              基本信息
            </h4>

            <div className="mb-5">
              <AvatarPicker value={avatar} onChange={setAvatar} size={80} />
            </div>

            {!library && (
              <Form.Item
                name="type"
                label="库类型"
                rules={[{ required: true, message: "请选择类型" }]}
              >
                <Select
                  options={PHOTO_TYPES.map((t) => ({
                    label: t.label,
                    value: t.value,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: "请输入图库名称" }]}
            >
              <Input placeholder="如：我的照片" size="large" />
            </Form.Item>

            <Form.Item name="description" label="描述" className="!mb-0">
              <Input.TextArea placeholder="可选描述" rows={3} />
            </Form.Item>
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              路径配置
            </h4>
            <StorageBindingsField
              sources={vfsSources}
              value={bindings}
              onChange={setBindings}
            />
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <SettingGroup
              title="AI 自动处理"
              desc='控制同步后自动执行的 AI 处理任务,关闭后可在下方"数据管理"中手动触发'
            >
              <SettingRow
                label="自动 OCR 文字识别"
                desc="同步后自动识别照片中的文字,可用于搜索"
              >
                <Form.Item name="autoOcr" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label="自动 CLIP 图像识别"
                desc="同步后自动生成图像向量,支持以文搜图"
              >
                <Form.Item name="autoClip" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label="自动人脸识别"
                desc="同步后自动检测和识别照片中的人脸"
              >
                <Form.Item name="autoFace" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label="自动地理位置解析"
                desc="同步后自动将 EXIF GPS 坐标转为可读地名"
              >
                <Form.Item name="autoGeo" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
            </SettingGroup>
          </div>

          {library && (
            <div className="rounded-lg border border-border-base p-5">
              <h4 className="mb-4 text-sm font-semibold text-fg-primary">
                数据管理
              </h4>
              <PhotoReprocessTools appId={library.id} />
            </div>
          )}
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-between border-t border-border-base px-5 py-3">
          <div>
            {library && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} className="mr-1" />
                删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={onCancel}>
              取消
            </Button>
            <Button loading={isPending} onClick={() => void handleSave()}>
              {library ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </Form>

      {library && (
        <DeleteConfirmModal
          library={library}
          open={deleteOpen}
          deleteInput={deleteInput}
          setDeleteInput={setDeleteInput}
          onCancel={() => {
            setDeleteOpen(false);
            setDeleteInput("");
          }}
          onConfirm={() => deleteMutation.mutate(library.id)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function DeleteConfirmModal({
  library,
  open,
  deleteInput,
  setDeleteInput,
  onCancel,
  onConfirm,
  loading,
}: {
  library: PhotoLibraryOutput;
  open: boolean;
  deleteInput: string;
  setDeleteInput: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Modal title="⚠️ 删除图库" open={open} onCancel={onCancel} footer={null}>
      <div className="space-y-4 pt-1">
        <p className="text-sm text-fg-secondary">
          此操作将永久删除{" "}
          <span className="font-semibold text-fg-primary">{library.name}</span>{" "}
          及其所有数据,
          <span className="font-semibold text-red-500">不可恢复</span>。
        </p>
        <Input
          value={deleteInput}
          onChange={(e) => setDeleteInput(e.target.value)}
          placeholder={library.name}
          onPressEnter={() => {
            if (deleteInput === library.name) onConfirm();
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={deleteInput !== library.name}
            loading={loading}
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </div>
      </div>
    </Modal>
  );
}
