import { useAppCtx } from "./AppContext";
import { enUS, zhCN } from "./i18n";

export default function PhotoContent() {
  const ctx = useAppCtx();
  const t = ctx.locale.startsWith("zh") ? zhCN : enUS;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl">📷</div>
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">{t.empty}</p>
    </div>
  );
}
