import { Modal } from "@tokimo/ui";
import { useRef } from "react";
import { getOcrModelName } from "@/lib/ocr-models";

interface OcrDebugInfo {
  detModel: string;
  vlmModel: string;
  detTexts: string[];
  vlmText: string;
}

interface OcrDebugModalProps {
  debugInfo: OcrDebugInfo;
  mergedTexts: string[];
  onClose: () => void;
}

function Section({
  title,
  modelId,
  children,
}: {
  title: string;
  modelId: string;
  children: React.ReactNode;
}) {
  const modelName = getOcrModelName(modelId) ?? modelId;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-medium text-[var(--text-primary)]">{title}</h3>
        <span className="rounded bg-black/[0.06] px-1.5 py-0.5 text-xs text-[var(--text-muted)] dark:bg-white/[0.08]">
          {modelName}
        </span>
      </div>
      {children}
    </div>
  );
}

function TextBlock({ text, index }: { text: string; index?: number }) {
  return (
    <div className="rounded bg-black/[0.04] px-3 py-2 dark:bg-white/[0.04]">
      <p className="whitespace-pre-wrap break-all font-mono text-sm leading-relaxed text-[var(--text-secondary)]">
        {index != null && (
          <span className="mr-2 select-none text-xs text-[var(--text-muted)]">
            [{index + 1}]
          </span>
        )}
        {text}
      </p>
    </div>
  );
}

export function OcrDebugModal({
  debugInfo,
  mergedTexts,
  onClose,
}: OcrDebugModalProps) {
  const bodyRef = useRef(document.body);

  return (
    <Modal
      open
      title="OCR 多模型识别详情"
      onCancel={onClose}
      footer={null}
      width={720}
      zIndex={10000}
      container={bodyRef}
    >
      <div className="space-y-5">
        {/* Detection model raw results */}
        <Section title="检测模型原始结果" modelId={debugInfo.detModel}>
          <div className="space-y-1">
            {debugInfo.detTexts.length > 0 ? (
              debugInfo.detTexts.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static debug display
                <TextBlock key={`det-${i}`} text={t} index={i} />
              ))
            ) : (
              <p className="text-sm text-[var(--text-muted)]">无检测结果</p>
            )}
          </div>
        </Section>

        {/* VLM model raw result */}
        <Section title="VLM 模型原始结果" modelId={debugInfo.vlmModel}>
          {debugInfo.vlmText ? (
            <TextBlock text={debugInfo.vlmText} />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">无 VLM 结果</p>
          )}
        </Section>

        {/* Merged result */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-[var(--text-primary)]">合并结果</h3>
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
              最终输出
            </span>
          </div>
          <div className="space-y-1">
            {mergedTexts.length > 0 ? (
              mergedTexts.map((t, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static debug display
                <TextBlock key={`merged-${i}`} text={t} index={i} />
              ))
            ) : (
              <p className="text-sm text-[var(--text-muted)]">无合并结果</p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
