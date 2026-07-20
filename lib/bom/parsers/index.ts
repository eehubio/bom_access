import type { ParseProgress, RawDocument, RawTable, SourceAsset, SourceType } from "../types";
import { createId, sha256 } from "../utils";
import { validateSource } from "../security";
import { parseDelimited } from "./delimited";
import { parseImage } from "./image";
import { parsePdf } from "./pdf";
import { parseSpreadsheet } from "./spreadsheet";
import { parsePastedText } from "./text";

function sourceTypeFor(file: File): SourceType {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xlsm", "xls", "xlsb"].includes(extension)) return extension as SourceType;
  if (extension === "csv") return "csv";
  if (extension === "tsv") return "tsv";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "txt") return "text";
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "tif", "tiff", "bmp"].includes(extension)) return "image";
  throw new Error("SOURCE_FORMAT_UNSUPPORTED");
}

function buildProfile(tables: RawTable[]) {
  const allCells = tables.flatMap((table) => table.cells);
  return {
    candidateTables: tables.map((table) => ({ tableId: table.tableId, score: 0 })),
    estimatedRows: tables.reduce((sum, table) => sum + table.matrix.length, 0),
    languageCandidates: ["zh-CN", "en"],
    hasFormulas: allCells.some((cell) => Boolean(cell.formula)),
    hasMergedCells: allCells.some((cell) => Boolean(cell.mergedRange)),
    hasHiddenRows: allCells.some((cell) => cell.hidden),
  };
}

function documentFromTables(asset: SourceAsset, tables: RawTable[], warnings: string[]): RawDocument {
  return {
    documentId: createId("document"),
    asset,
    tables,
    profile: buildProfile(tables),
    warnings: [...warnings, ...tables.flatMap((table) => table.warnings)],
  };
}

export async function parseFile(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<RawDocument> {
  const sourceType = sourceTypeFor(file);
  onProgress?.({ stage: "SECURITY_SCANNING", progress: 5, detail: "校验文件头、大小与压缩比" });
  const buffer = await file.arrayBuffer();
  const warnings = validateSource(file, sourceType, buffer);
  const prefix = new TextDecoder("utf-8", { fatal: false }).decode(buffer.slice(0, 1024));
  if (["xlsx", "xlsm", "xls", "xlsb"].includes(sourceType) && /<html[\s>]|github\.com|sign in to github/i.test(prefix)) {
    throw new Error("SPREADSHEET_FILE_IS_HTML: 下载到的是网页而非 Excel 原文件，请从原始链接重新下载后再上传。");
  }
  const digest = await sha256(buffer);
  const asset: SourceAsset = {
    assetId: createId("asset"),
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    sha256: digest,
    sourceType,
    hasMacros: sourceType === "xlsm",
    createdAt: new Date().toISOString(),
  };
  onProgress?.({ stage: "SELECTING_ADAPTER", progress: 12, detail: `使用 ${sourceType.toUpperCase()} Adapter` });
  let tables: RawTable[];
  if (["xlsx", "xlsm", "xls", "xlsb"].includes(sourceType)) {
    tables = await parseSpreadsheet(buffer, sourceType);
  } else if (["csv", "tsv"].includes(sourceType)) {
    tables = await parseDelimited(buffer, sourceType);
  } else if (["text", "markdown", "html"].includes(sourceType)) {
    const text = new TextDecoder("utf-8").decode(buffer);
    tables = parsePastedText(text, sourceType);
  } else if (sourceType === "pdf") {
    tables = await parsePdf(buffer, onProgress);
  } else {
    tables = await parseImage(file, onProgress);
  }
  onProgress?.({ stage: "EXTRACTING_RAW_DOCUMENT", progress: 70, detail: `已提取 ${tables.length} 个候选表格` });
  return documentFromTables(asset, tables, warnings);
}

export async function parseText(text: string): Promise<RawDocument> {
  const bytes = new TextEncoder().encode(text);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const asset: SourceAsset = {
    assetId: createId("asset"),
    filename: "pasted-bom.txt",
    mime: "text/plain",
    size: bytes.byteLength,
    sha256: await sha256(buffer),
    sourceType: "text",
    hasMacros: false,
    createdAt: new Date().toISOString(),
  };
  return documentFromTables(asset, parsePastedText(text), []);
}
