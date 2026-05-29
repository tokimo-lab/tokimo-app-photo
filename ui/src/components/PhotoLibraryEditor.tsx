/**
 * PhotoLibraryEditor — inline editor for creating / editing a photo library.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { ShellApi } from "@tokimo/sdk";
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
  StorageBindingsField,
  Switch,
  useToast,
  type VideoBinding,
} from "@tokimo/ui";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type PhotoLibraryOutput } from "../api/client";
import { useVfsBrowse } from "../hooks/useVfsBrowse";
import { getPhotoI18n } from "../i18n";
import PhotoReprocessTools from "./PhotoReprocessTools";

interface PhotoLibraryEditorProps {
  photoId?: string;
  shell: ShellApi;
  locale?: string;
  onSaved?: (savedId: string) => void;
  onDeleted?: () => void;
  onCancel?: () => void;
}

export default function PhotoLibraryEditor({
  photoId,
  shell,
  locale,
  onSaved,
  onDeleted,
  onCancel,
}: PhotoLibraryEditorProps) {
  const toast = useToast();
  const { t } = getPhotoI18n(locale);
  const onBrowse = useVfsBrowse(shell, locale);
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data: libraries = [] } = api.photo.list.useQuery();
  const { data: vfsSources = [] } = api.vfs.list.useQuery();
  const library = photoId ? libraries.find((c) => c.id === photoId) : undefined;

  const [avatar, setAvatar] = useState<AvatarData | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");

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
    }
  }, [library, form]);

  const PHOTO_TYPES = [
    { value: "photo", label: t("libraryTypePhoto") },
    { value: "screenshot", label: t("libraryTypeScreenshot") },
  ] as const;

  const createMutation = api.photo.create.useMutation({
    onSuccess: (created) => {
      toast.success(t("libraryCreated"));
      api.photo.list.invalidate(qc);
      onSaved?.(created.id);
    },
    onError: (e) => toast.error(e.message || t("libraryCreateFailed")),
  });

  const updateMutation = api.photo.update.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(t("librarySaved"));
      api.photo.list.invalidate(qc);
      onSaved?.(variables.id);
    },
    onError: (e) => toast.error(e.message || t("librarySaveFailed")),
  });

  const deleteMutation = api.photo.delete.useMutation({
    onSuccess: () => {
      toast.success(t("libraryDeleted"));
      api.photo.list.invalidate(qc);
      setDeleteOpen(false);
      onDeleted?.();
    },
    onError: (e) => toast.error(e.message || t("libraryDeleteFailed")),
  });

  const handleSave = useCallback(async () => {
    const values = await form.validateFields();
    const rawBindings =
      (form.getFieldValue("bindings") as VideoBinding[] | undefined) ?? [];
    const sources = rawBindings
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
  }, [form, library, avatar, createMutation, updateMutation]);

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
              {t("editorBasicInfo")}
            </h4>

            <div className="mb-5">
              <AvatarPicker value={avatar} onChange={setAvatar} size={80} />
            </div>

            {!library && (
              <Form.Item
                name="type"
                label={t("editorLibraryType")}
                rules={[{ required: true, message: t("editorSelectType") }]}
              >
                <Select
                  options={PHOTO_TYPES.map((tp) => ({
                    label: tp.label,
                    value: tp.value,
                  }))}
                />
              </Form.Item>
            )}

            <Form.Item
              name="name"
              label={t("editorName")}
              rules={[{ required: true, message: t("editorNameRequired") }]}
            >
              <Input placeholder={t("editorNamePlaceholder")} size="large" />
            </Form.Item>

            <Form.Item name="description" label={t("editorDescription")} className="!mb-0">
              <Input.TextArea placeholder={t("editorDescriptionPlaceholder")} rows={3} />
            </Form.Item>
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <h4 className="mb-4 text-sm font-semibold text-fg-primary">
              {t("editorPathConfig")}
            </h4>
            <StorageBindingsField
              sources={vfsSources}
              form={form}
              initialSources={library?.sources}
              onBrowse={onBrowse}
            />
          </div>

          <div className="rounded-lg border border-border-base p-5">
            <SettingGroup
              title={t("editorAiServices")}
              desc={t("editorAiServicesDesc")}
            >
              <SettingRow
                label={t("editorAutoOcr")}
                desc={t("editorAutoOcrDesc")}
              >
                <Form.Item name="autoOcr" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label={t("editorAutoClip")}
                desc={t("editorAutoClipDesc")}
              >
                <Form.Item name="autoClip" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label={t("editorAutoFace")}
                desc={t("editorAutoFaceDesc")}
              >
                <Form.Item name="autoFace" valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </SettingRow>
              <SettingRow
                label={t("editorAutoGeo")}
                desc={t("editorAutoGeoDesc")}
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
                {t("editorDataManagement")}
              </h4>
              <PhotoReprocessTools appId={library.id} locale={locale} />
            </div>
          )}
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-between border-t border-border-base px-5 py-3">
          <div>
            {library && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} className="mr-1" />
                {t("deleteButton")}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="default" onClick={onCancel}>
              {t("commonCancel")}
            </Button>
            <Button loading={isPending} onClick={() => void handleSave()}>
              {library ? t("commonSave") : t("commonCreate")}
            </Button>
          </div>
        </div>
      </Form>

      {library && (
        <DeleteConfirmModal
          library={library}
          locale={locale}
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
  locale,
  open,
  deleteInput,
  setDeleteInput,
  onCancel,
  onConfirm,
  loading,
}: {
  library: PhotoLibraryOutput;
  locale?: string;
  open: boolean;
  deleteInput: string;
  setDeleteInput: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const { t } = getPhotoI18n(locale);
  return (
    <Modal title={t("deleteLibraryTitle")} open={open} onCancel={onCancel} footer={null}>
      <div className="space-y-4 pt-1">
        <p className="text-sm text-fg-secondary">
          {t("deleteLibraryMessage", {
            name: library.name,
            irreversible: t("irreversible"),
          })}
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
            {t("commonCancel")}
          </Button>
          <Button
            variant="danger"
            disabled={deleteInput !== library.name}
            loading={loading}
            onClick={onConfirm}
          >
            {t("confirmDelete")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
