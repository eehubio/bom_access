import type { SourceType } from "./types";

export const SOURCE_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 500,
  maxCells: 500_000,
  maxPdfPages: 50,
  maxImagePixels: 40_000_000,
  maxZipRatio: 100,
  maxExpandedBytes: 150 * 1024 * 1024,
} as const;

const MIME_BY_TYPE: Partial<Record<SourceType, string[]>> = {
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"],
  xlsm: ["application/vnd.ms-excel.sheet.macroenabled.12", "application/octet-stream"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsb: ["application/vnd.ms-excel.sheet.binary.macroenabled.12", "application/octet-stream"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
  tsv: ["text/tab-separated-values", "text/plain", "application/octet-stream"],
  text: ["text/plain", "application/octet-stream"],
  markdown: ["text/markdown", "text/plain", "application/octet-stream"],
  html: ["text/html", "application/octet-stream"],
  pdf: ["application/pdf", "application/octet-stream"],
  image: ["image/png", "image/jpeg", "image/webp", "image/tiff", "image/bmp", "application/octet-stream"],
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function validateMagic(type: SourceType, bytes: Uint8Array): boolean {
  if (["csv", "tsv", "text", "markdown", "html"].includes(type)) return true;
  if (["xlsx", "xlsm", "xlsb"].includes(type)) return startsWith(bytes, [0x50, 0x4b]);
  if (type === "xls") return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
  if (type === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  if (type === "image") {
    return (
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
      startsWith(bytes, [0xff, 0xd8, 0xff]) ||
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) ||
      startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
      startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) ||
      startsWith(bytes, [0x42, 0x4d])
    );
  }
  return false;
}

function inspectZip(buffer: ArrayBuffer): void {
  const view = new DataView(buffer);
  let compressed = 0;
  let expanded = 0;
  for (let offset = 0; offset + 46 <= view.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    compressed += view.getUint32(offset + 20, true);
    expanded += view.getUint32(offset + 24, true);
    const filenameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 45 + filenameLength + extraLength + commentLength;
  }
  if (expanded > SOURCE_LIMITS.maxExpandedBytes) throw new Error("SOURCE_ARCHIVE_BOMB");
  if (compressed > 0 && expanded / compressed > SOURCE_LIMITS.maxZipRatio) {
    throw new Error("SOURCE_ARCHIVE_BOMB");
  }
}

export function validateSource(file: File, type: SourceType, buffer: ArrayBuffer): string[] {
  if (file.size > SOURCE_LIMITS.maxFileBytes) throw new Error("SOURCE_FILE_TOO_LARGE");
  const acceptedMimes = MIME_BY_TYPE[type] ?? [];
  if (file.type && !acceptedMimes.includes(file.type)) throw new Error("SOURCE_MIME_INVALID");
  if (!validateMagic(type, new Uint8Array(buffer.slice(0, 16)))) throw new Error("SOURCE_MIME_INVALID");
  if (["xlsx", "xlsm", "xlsb"].includes(type)) inspectZip(buffer);
  const warnings: string[] = [];
  if (type === "xlsm") warnings.push("检测到宏文件；系统只读取单元格数据，不执行 VBA 宏。 ");
  return warnings;
}
