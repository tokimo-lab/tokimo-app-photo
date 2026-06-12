import {
  Alert,
  Button,
  Card,
  Form,
  type FormInstance,
  Input,
  Select,
  Spin,
  Switch,
  useToast,
} from "@tokimo/ui";
import {
  CheckCircle,
  HelpCircle,
  Plug,
  Save,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/generated/rust-api";
import { usePhotoI18n } from "../i18n";

const PROVIDERS = ["amap", "qqmap", "tianditu", "mapbox", "maptiler"] as const;
type Provider = (typeof PROVIDERS)[number];

/** China-only providers that may benefit from a fallback */
const CHINA_PROVIDERS = new Set<string>(["amap", "qqmap", "tianditu"]);

const PROVIDER_LABELS: Record<Provider, string> = {
  amap: "高德地图",
  qqmap: "腾讯地图",
  tianditu: "天地图",
  mapbox: "Mapbox",
  maptiler: "MapTiler",
};

/** Provider-specific links */
const PROVIDER_LINKS: Record<
  Provider,
  { site: string; doc: string }
> = {
  amap: {
    site: "https://lbs.amap.com/",
    doc: "https://lbs.amap.com/api/webservice/guide/api/georegeo",
  },
  qqmap: {
    site: "https://lbs.qq.com/",
    doc: "https://lbs.qq.com/service/webService/webServiceGuide/webServiceGcoder",
  },
  tianditu: {
    site: "https://lbs.tianditu.gov.cn/",
    doc: "https://lbs.tianditu.gov.cn/server/geocoding.html",
  },
  mapbox: {
    site: "https://docs.mapbox.com/",
    doc: "https://docs.mapbox.com/api/search/geocoding/",
  },
  maptiler: {
    site: "https://docs.maptiler.com/",
    doc: "https://docs.maptiler.com/cloud/api/geocoding/",
  },
};

function ProviderKeyFields({ provider }: { provider: string }) {
  switch (provider) {
    case "amap":
      return (
        <>
          <Form.Item
            name="amapApiKey"
            label="API Key"
            extra="在高德开放平台申请的服务端 Key"
          >
            <Input.Password placeholder="输入高德 API Key" />
          </Form.Item>
          <Form.Item
            name="amapSecret"
            label="安全密钥"
            extra="高德 Web 服务安全密钥（可选）"
          >
            <Input.Password placeholder="输入安全密钥" />
          </Form.Item>
          <Form.Item
            name="amapJsApiKey"
            label="JS API Key"
            extra="用于前端地图展示的 Key（可选）"
          >
            <Input.Password placeholder="输入 JS API Key" />
          </Form.Item>
        </>
      );
    case "qqmap":
      return (
        <>
          <Form.Item
            name="qqmapApiKey"
            label="API Key"
            extra="腾讯位置服务 Key"
          >
            <Input.Password placeholder="输入腾讯地图 Key" />
          </Form.Item>
          <Form.Item
            name="qqmapSecretKey"
            label="安全密钥"
            extra="腾讯位置服务安全密钥（可选）"
          >
            <Input.Password placeholder="输入安全密钥" />
          </Form.Item>
        </>
      );
    case "tianditu":
      return (
        <>
          <Form.Item
            name="tiandituServerKey"
            label="服务端 Key"
            extra="天地图服务端 API Key"
          >
            <Input.Password placeholder="输入服务端 Key" />
          </Form.Item>
          <Form.Item
            name="tiandituBrowserKey"
            label="浏览器端 Key"
            extra="天地图浏览器端 API Key（可选）"
          >
            <Input.Password placeholder="输入浏览器端 Key" />
          </Form.Item>
        </>
      );
    case "mapbox":
      return (
        <Form.Item
          name="mapboxAccessToken"
          label="Access Token"
          extra="Mapbox API Access Token"
        >
          <Input.Password placeholder="输入 Mapbox Token" />
        </Form.Item>
      );
    case "maptiler":
      return (
        <Form.Item
          name="maptilerApiKey"
          label="API Key"
          extra="MapTiler API Key"
        >
          <Input.Password placeholder="输入 MapTiler Key" />
        </Form.Item>
      );
    default:
      return null;
  }
}

/** Get whether a provider has its key configured */
function getProviderKeyStatus(
  provider: string,
  data: {
    amapApiKey?: string | null;
    qqmapApiKey?: string | null;
    tiandituServerKey?: string | null;
    mapboxAccessToken?: string | null;
    maptilerApiKey?: string | null;
  },
): boolean {
  switch (provider) {
    case "amap":
      return !!data.amapApiKey;
    case "qqmap":
      return !!data.qqmapApiKey;
    case "tianditu":
      return !!data.tiandituServerKey;
    case "mapbox":
      return !!data.mapboxAccessToken;
    case "maptiler":
      return !!data.maptilerApiKey;
    default:
      return false;
  }
}

/** Geo settings content — can be embedded in tabs or used standalone */
export function PhotoGeoSettingsContent() {
  const { t } = usePhotoI18n();
  const [form] = Form.useForm();
  const toast = useToast();

  const settingsQuery = api.photo.getGeoSettings.useQuery();
  const updateMutation = api.photo.updateGeoSettings.useMutation();

  const [selectedProvider, setSelectedProvider] = useState<string>("amap");

  useEffect(() => {
    if (settingsQuery.data) {
      const d = settingsQuery.data;
      form.setFieldsValue({
        provider: d.provider || "amap",
        enabled: d.enabled,
        amapApiKey: d.amapApiKey ?? "",
        amapSecret: d.amapSecret ?? "",
        amapJsApiKey: d.amapJsApiKey ?? "",
        qqmapApiKey: d.qqmapApiKey ?? "",
        qqmapSecretKey: d.qqmapSecretKey ?? "",
        tiandituServerKey: d.tiandituServerKey ?? "",
        tiandituBrowserKey: d.tiandituBrowserKey ?? "",
        mapboxAccessToken: d.mapboxAccessToken ?? "",
        maptilerApiKey: d.maptilerApiKey ?? "",
        fallbackProvider: d.fallbackProvider ?? "",
      });
      setSelectedProvider(d.provider || "amap");
    }
  }, [settingsQuery.data, form]);

  const providerOptions = useMemo(
    () =>
      PROVIDERS.map((p) => ({
        value: p,
        label: PROVIDER_LABELS[p],
      })),
    [],
  );

  const fallbackOptions = useMemo(() => {
    const opts = PROVIDERS.filter((p) => p !== selectedProvider).map((p) => ({
      value: p,
      label: PROVIDER_LABELS[p],
    }));
    return [{ value: "", label: "不使用" }, ...opts];
  }, [selectedProvider]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      await updateMutation.mutateAsync({
        provider: values.provider,
        enabled: values.enabled ?? false,
        amapApiKey: values.amapApiKey || null,
        amapSecret: values.amapSecret || null,
        amapJsApiKey: values.amapJsApiKey || null,
        qqmapApiKey: values.qqmapApiKey || null,
        qqmapSecretKey: values.qqmapSecretKey || null,
        tiandituServerKey: values.tiandituServerKey || null,
        tiandituBrowserKey: values.tiandituBrowserKey || null,
        mapboxAccessToken: values.mapboxAccessToken || null,
        maptilerApiKey: values.maptilerApiKey || null,
        fallbackProvider: values.fallbackProvider || null,
      });
      toast.success("地理位置设置已保存");
      settingsQuery.refetch();
    } catch {
      toast.error("保存失败");
    }
  };

  const testMutation = api.photo.testGeoConnection.useMutation();

  const handleTest = async () => {
    try {
      const result = await testMutation.mutateAsync();
      const allPassed = result.results.every((r) => r.success);
      if (allPassed) {
        toast.success("地理服务连接正常");
      } else {
        toast.error("地理服务连接失败");
      }
    } catch {
      toast.error("测试失败");
    }
  };

  const activeLinks =
    PROVIDER_LINKS[selectedProvider as Provider] ?? PROVIDER_LINKS.amap;

  const keyConfigured = settingsQuery.data
    ? getProviderKeyStatus(
        settingsQuery.data.provider || "amap",
        settingsQuery.data,
      )
    : false;

  return (
    <div className="flex flex-col gap-6">
      {/* Status overview */}
      <Card
        className="p-5"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-fg-primary">状态概览</h3>
          {!settingsQuery.isLoading && (
            <span
              className={
                settingsQuery.data?.enabled
                  ? "text-sm text-green-600 dark:text-green-500"
                  : "text-sm text-zinc-600 dark:text-gray-500"
              }
            >
              {settingsQuery.data?.enabled ? "已启用" : "已禁用"}
            </span>
          )}
        </div>
        {settingsQuery.isLoading ? (
          <Spin />
        ) : (
          <div className="mt-2 space-y-2 text-sm text-gray-600 dark:text-zinc-400">
            <p>
              当前服务商:{" "}
              <strong className="text-gray-900 dark:text-gray-100">
                {PROVIDER_LABELS[
                  (settingsQuery.data?.provider || "amap") as Provider
                ] ?? settingsQuery.data?.provider}
              </strong>
            </p>
            <p>
              API Key 状态:{" "}
              <strong className="text-gray-900 dark:text-gray-100">
                {keyConfigured ? "已配置" : "未配置"}
              </strong>
            </p>
          </div>
        )}
      </Card>

      {/* Tip */}
      <Alert type="info" showIcon message="中国大陆地区建议使用高德或腾讯地图服务" />

      {/* Configuration form */}
      <Card className="p-5">
        <h3 className="mb-4 font-medium text-fg-primary">地理编码配置</h3>
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
              name="enabled"
              label="启用地理编码"
              extra="开启后将自动解析照片 EXIF 中的 GPS 坐标为可读地名"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="provider"
              label="服务商"
              extra="选择地理编码 API 服务商"
            >
              <Select
                options={providerOptions}
                onChange={(val: string) => setSelectedProvider(val)}
              />
            </Form.Item>

            <ProviderKeyFields provider={selectedProvider} />

            {CHINA_PROVIDERS.has(selectedProvider) && (
              <Form.Item
                name="fallbackProvider"
                label="备用服务商"
                extra="当主服务商失败时自动使用（仅中国大陆服务商支持）"
              >
                <Select options={fallbackOptions} />
              </Form.Item>
            )}

            <Form.Item>
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  icon={<Save />}
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

      {/* Usage instructions */}
      <Card className="p-5">
        <h3 className="mb-3 font-medium text-fg-primary">使用说明</h3>
        <Alert
          type="info"
          showIcon
          icon={<HelpCircle />}
          message="配置步骤"
          description={
            <ol className="mt-2 list-inside list-decimal space-y-2">
              <li>选择一个地理编码服务商</li>
              <li>在服务商官网注册并申请 API Key</li>
              <li>将 Key 填入上方表单并保存</li>
              <li>点击「测试连接」验证配置是否正确</li>
            </ol>
          }
        />
      </Card>

      {/* Related links */}
      <Card className="p-5">
        <h3 className="mb-3 font-medium text-fg-primary">相关链接</h3>
        <div className="space-y-1 text-sm">
          <div>
            <a
              className="text-[var(--accent-text)] hover:text-[var(--accent)]"
              href={activeLinks.site}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PROVIDER_LABELS[selectedProvider as Provider]} 官网
            </a>
          </div>
          <div>
            <a
              className="text-[var(--accent-text)] hover:text-[var(--accent)]"
              href={activeLinks.doc}
              target="_blank"
              rel="noopener noreferrer"
            >
              逆地理编码 API 文档
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function PhotoGeoSettingsWindow() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200">
          地理位置设置
        </h1>
        <p className="mt-1 text-slate-500">
          配置照片地理编码服务，将 GPS 坐标转换为可读地名
        </p>
      </div>
      <PhotoGeoSettingsContent />
    </div>
  );
}
