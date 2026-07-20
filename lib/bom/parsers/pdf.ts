import type { ParseProgress, RawCell, RawTable } from "../types";
import { createId } from "../utils";
import { SOURCE_LIMITS } from "../security";
import { parseImageWithOcr } from "./ocr";

interface PdfTextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

interface PositionedText extends PdfTextItem {
  x: number;
  y: number;
}

function groupRows(items: PositionedText[]): PositionedText[][] {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const rows: PositionedText[][] = [];
  sorted.forEach((item) => {
    const row = rows.find((candidate) => Math.abs((candidate[0]?.y ?? item.y) - item.y) <= 4);
    if (row) row.push(item);
    else rows.push([item]);
  });
  return rows.map((row) => row.sort((left, right) => left.x - right.x));
}

function nativePageTable(items: PositionedText[], page: number): RawTable {
  const rows = groupRows(items);
  const matrix = rows.map((row) => row.map((item) => item.str.trim()));
  const cells: RawCell[] = [];
  rows.forEach((row, rowIndex) =>
    row.forEach((item, columnIndex) => {
      cells.push({
        cellId: createId("cell"),
        page,
        row: rowIndex,
        column: columnIndex,
        address: `P${page}:R${rowIndex + 1}C${columnIndex + 1}`,
        rawValue: item.str,
        displayValue: item.str.trim(),
        formula: null,
        dataType: "string",
        numberFormat: null,
        style: null,
        comment: null,
        mergedRange: null,
        hidden: false,
        bbox: { x: item.x, y: item.y, width: item.width, height: item.height },
        ocrText: null,
        ocrConfidence: null,
      });
    }),
  );
  return {
    tableId: createId("table"),
    name: `PDF Page ${page}`,
    sourceType: "pdf",
    page,
    matrix,
    cells,
    warnings: ["PDF 表格基于文本层坐标重建；bbox 已作为字段证据保留。"],
  };
}

export async function parsePdf(
  buffer: ArrayBuffer,
  onProgress?: (progress: ParseProgress) => void,
): Promise<RawTable[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const pdfDocument = await pdfjs.getDocument({ data: buffer }).promise;
  if (pdfDocument.numPages > SOURCE_LIMITS.maxPdfPages) throw new Error("SOURCE_FILE_TOO_LARGE");
  const tables: RawTable[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    onProgress?.({
      stage: "PDF_EXTRACTING",
      progress: Math.round(((pageNumber - 1) / pdfDocument.numPages) * 100),
      detail: `正在解析第 ${pageNumber}/${pdfDocument.numPages} 页`,
    });
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const rawItems = content.items as unknown[];
    const items: PositionedText[] = rawItems
      .filter((item): item is PdfTextItem => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<PdfTextItem>;
        return (
          typeof candidate.str === "string" &&
          Boolean(candidate.str.trim()) &&
          Array.isArray(candidate.transform)
        );
      })
      .map((item) => ({
        ...item,
        x: item.transform[4] ?? 0,
        y: item.transform[5] ?? 0,
      }));
    const textLength = items.reduce((sum, item) => sum + item.str.length, 0);
    if (textLength >= 20) {
      tables.push(nativePageTable(items, pageNumber));
      continue;
    }

    const viewport = page.getViewport({ scale: 2 });
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("OCR_FAILED");
    await page.render({ canvasContext: context, viewport }).promise;
    const ocrTable = await parseImageWithOcr(
      canvas,
      "pdf",
      `Scanned PDF Page ${pageNumber}`,
      onProgress,
    );
    ocrTable.page = pageNumber;
    ocrTable.cells.forEach((cell) => {
      cell.page = pageNumber;
    });
    tables.push(ocrTable);
  }
  return tables;
}
