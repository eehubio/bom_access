import type { ParseResult } from "papaparse";
import type { RawTable, SourceType } from "../types";
import { tableFromMatrix } from "./shared";

function decodeWithFallback(buffer: ArrayBuffer): { text: string; encoding: string; warning?: string } {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buffer),
      encoding: "utf-8",
    };
  } catch {
    for (const encoding of ["gb18030", "big5", "windows-1252"]) {
      try {
        const text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
        return {
          text,
          encoding,
          warning: `源文件不是 UTF-8，已按 ${encoding} 解码；建议人工确认编码。`,
        };
      } catch {
        continue;
      }
    }
  }
  throw new Error("SOURCE_ENCODING_AMBIGUOUS");
}

export async function parseDelimited(
  buffer: ArrayBuffer,
  sourceType: SourceType,
): Promise<RawTable[]> {
  const Papa = (await import("papaparse")).default;
  const decoded = decodeWithFallback(buffer);
  const result: ParseResult<string[]> = Papa.parse(decoded.text, {
    delimiter: sourceType === "tsv" ? "\t" : "",
    skipEmptyLines: "greedy",
    quoteChar: '"',
    escapeChar: '"',
  });
  const warnings = [
    ...(decoded.warning ? [decoded.warning] : []),
    ...result.errors.slice(0, 5).map((error) => `CSV 行 ${error.row ?? "?"}: ${error.message}`),
    `检测编码：${decoded.encoding}；分隔符：${result.meta.delimiter || "未知"}`,
  ];
  return [tableFromMatrix("Delimited BOM", sourceType, result.data, { warnings })];
}
