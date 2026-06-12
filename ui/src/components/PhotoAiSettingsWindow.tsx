import {
  Button,
  Card,
  Form,
  type FormInstance,
  Select,
  Spin,
  Switch,
  useToast,
} from "@tokimo/ui";
import { CheckCircle, Plug, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/generated/rust-api";
import { usePhotoI18n } from "../i18n";
import { DEFAULT_OCR_MODEL, OCR_MODELS } from "../lib/ocr-models";

/** AI settings content — can be embedded in tabs or used standalone */
export function PhotoAiSettingsContent() {
  const { t } = usePhotoI18n();
  const toast = useToast();
  const [form] = Form.useForm();

  const settingsQuery = api.photo.getAiSettings.useQuery();
  const updateMutation = api.photo.updateAiSettings.useMutation();
  const testMutation = api.photo.testAiConnection.useMutation();

  useEffect(() => {
    if (settingsQuery.data) {
      const d = settingsQuery.data;
      form.setFieldsValue({
        ocrEnabled: d.ocrEnabled,
        clipEnabled: d.clipEnabled,
        faceEnabled: d.faceEnabled,
        ocrModelName: d.ocrModelName ?? DEFAULT_OCR_MODEL,
      });
    }
  }, [settingsQuery.data, form]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      await updateMutation.mutateAsync({
        ocrEnabled: values.ocrEnabled ?? false,
        clipEnabled: values.clipEnabled ?? false,
        faceEnabled: values.faceEnabled ?? false,
        ocrModelName: values.ocrModelName ?? DEFAULT_OCR_MODEL,
        ocrDetMaxSide: settingsQuery.data?.ocrDetMaxSide ?? null,
      });
      toast.success("AI 设置已保存");
      settingsQuery.refetch();
    } catch {
      toast.error("保存失败");
    }
  }, [form, updateMutation, settingsQuery, toast]);

  const handleTest = useCallback(async () => {
    try {
      const result = await testMutation.mutateAsync();
      const allPassed = result.results.every((r) => r.success);
      if (allPassed) {
        toast.success("AI 服务连接正常");
      } else {
        toast.error("AI 服务连接失败");
      }
    } catch {
      toast.error("测试失败");
    }
  }, [testMutation, toast]);

  return (
    <div className="flex flex-col gap-6">
      {/* Status overview */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-fg-primary">AI 模型状态</h3>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          管理 OCR 文字识别、CLIP 图像识别和人脸识别功能
        </p>

        {settingsQuery.isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Spin />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Status indicators */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "OCR 文字识别",
                  enabled: settingsQuery.data?.ocrEnabled ?? false,
                },
                {
                  label: "CLIP 图像识别",
                  enabled: settingsQuery.data?.clipEnabled ?? false,
                },
                {
                  label: "人脸识别",
                  enabled: settingsQuery.data?.faceEnabled ?? false,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 rounded-lg border border-border-base bg-surface-glass p-3"
                >
                  {item.enabled ? (
                    <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-fg-muted" />
                  )}
                  <span className="text-sm text-fg-primary">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Configuration form */}
      <Card className="p-5">
        <h3 className="mb-4 font-medium text-fg-primary">功能配置</h3>
        {settingsQuery.isLoading ? (
          <Spin />
        ) : (
          <Form
            form={form as FormInstance}
            layout="vertical"
            className="max-w-xl"
            autoComplete="off"
          >
            <Form.Item
              name="ocrEnabled"
              label="OCR 文字识别"
              extra="同步后自动识别照片中的文字，可用于搜索"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="ocrModelName"
              label="OCR 模型"
              extra="选择用于文字识别的模型"
            >
              <Select
                options={OCR_MODELS.map((m) => ({
                  value: m.id,
                  label: (
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs opacity-50">{m.speed}</span>
                    </div>
                  ),
                }))}
              />
            </Form.Item>

            <Form.Item
              name="clipEnabled"
              label="CLIP 图像识别"
              extra="同步后自动生成图像向量，支持以文搜图"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="faceEnabled"
              label="人脸识别"
              extra="同步后自动检测和识别照片中的人脸"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={updateMutation.isPending}
                >
                  保存
                </Button>
                <Button
                  icon={<Plug />}
                  onClick={handleTest}
                  loading={testMutation.isPending}
                >
                  测试连接
                </Button>
              </div>
            </Form.Item>
          </Form>
        )}
      </Card>

      {/* Test results */}
      {testMutation.data && (
        <Card className="p-5">
          <h3 className="mb-3 font-medium text-fg-primary">测试结果</h3>
          <div className="space-y-3">
            {testMutation.data.results.map((r) => (
              <div key={r.name} className="flex items-start gap-2 text-sm">
                {r.success ? (
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div>
                  <span className="font-medium text-fg-primary">{r.name}</span>
                  <span className="ml-2 text-fg-muted">{r.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default function PhotoAiSettingsWindow() {
  const { t } = usePhotoI18n();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
          AI 智能设置
        </h1>
        <p className="mt-1 text-slate-500">
          管理图库的 AI 处理功能和模型配置
        </p>
      </div>
      <PhotoAiSettingsContent />
    </div>
  );
}
