export interface OcrModelDef {
  id: string;
  name: string;
  speed: string;
  accuracy: string;
  requiresSidecar?: boolean;
  /** Whether this model runs natively in Rust (no Python sidecar) */
  rustNative?: boolean;
  /** Whether this model can provide text bounding boxes for selection */
  supportsBlocks: boolean;
  /** Technical details shown in tag tooltip */
  techDetail?: string;
}

export const OCR_MODELS: OcrModelDef[] = [
  {
    id: "rapid-ocr-rust",
    name: "RapidOCR",
    speed: "🟢 ~300ms",
    accuracy: "~90%",
    rustNative: true,
    supportsBlocks: true,
    techDetail:
      "PP-OCRv5 Server 检测 + CTC 识别，Contours 旋转文字检测，ONNX Runtime 推理",
  },
  {
    id: "pp-ocrv5-mobile",
    name: "PP-OCRv5 Mobile",
    speed: "⚡ ~60ms",
    accuracy: "~81%",
    rustNative: true,
    supportsBlocks: true,
    techDetail:
      "PP-OCRv5 Mobile 轻量模型，轴对齐检测，适合大批量快速扫描，ONNX Runtime 推理",
  },
  {
    id: "got-ocr-2",
    name: "GOT-OCR 2.0",
    speed: "🟡 ~3-5s",
    accuracy: "~93%",
    requiresSidecar: true,
    supportsBlocks: false,
    techDetail:
      "视觉语言模型 (VLM)，端到端 OCR 无需检测步骤，支持复杂排版，需 Python Sidecar + GPU",
  },
];

export const DEFAULT_OCR_MODEL = "rapid-ocr-rust";

export function getOcrModelName(
  modelId: string | null | undefined,
): string | null {
  if (!modelId) return null;
  return OCR_MODELS.find((m) => m.id === modelId)?.name ?? modelId;
}
