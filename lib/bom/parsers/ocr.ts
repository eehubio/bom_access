import type { ParseProgress, RawTable, SourceType } from "../types";
import { tableFromMatrix } from "./shared";

function ocrTextToRows(text: string): string[][] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => line.includes("\t"))) {
    return lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  }
  return lines.map((line) => line.split(/\s{2,}/).map((cell) => cell.trim()));
}

export async function parseImageWithOcr(
  image: Blob | HTMLCanvasElement,
  sourceType: SourceType,
  name: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<RawTable> {
  const Tesseract = await import("tesseract.js");
  const worker = await Tesseract.createWorker("eng+chi_sim", undefined, {
    logger: (message) => {
      if (typeof message.progress === "number") {
        onProgress?.({
          stage: "OCR_RECOGNIZING",
          progress: Math.round(message.progress * 100),
          detail: message.status,
        });
      }
    },
  });
  try {
    const result = await worker.recognize(image);
    const rows = ocrTextToRows(result.data.text);
    if (!rows.length) throw new Error("OCR_FAILED");
    const table = tableFromMatrix(name, sourceType, rows, {
      warnings: [
        "OCR 结果保留原始字符，不会自动修正 O/0、I/1、S/5 等高风险字符。",
        "图片表格的行列重建为启发式结果，低置信度字段需要人工审核。",
      ],
    });
    table.cells.forEach((cell) => {
      cell.ocrConfidence = typeof result.data.confidence === "number" ? result.data.confidence / 100 : null;
    });
    return table;
  } finally {
    await worker.terminate();
  }
}
