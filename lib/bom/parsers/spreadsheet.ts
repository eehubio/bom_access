import type { RawCell, RawTable, SourceType } from "../types";
import { createId } from "../utils";
import { SOURCE_LIMITS } from "../security";

export async function parseSpreadsheet(
  buffer: ArrayBuffer,
  sourceType: SourceType,
): Promise<RawTable[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellFormula: true,
    cellStyles: true,
    cellDates: false,
    cellNF: true,
    dense: false,
  });
  const tables: RawTable[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) return;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    if (
      rowCount > SOURCE_LIMITS.maxRows ||
      columnCount > SOURCE_LIMITS.maxColumns ||
      rowCount * columnCount > SOURCE_LIMITS.maxCells
    ) {
      throw new Error("SOURCE_FILE_TOO_LARGE");
    }

    const merges = sheet["!merges"] ?? [];
    const mergeByAddress = new Map<string, string>();
    merges.forEach((merge) => {
      const mergeRange = XLSX.utils.encode_range(merge);
      for (let row = merge.s.r; row <= merge.e.r; row += 1) {
        for (let column = merge.s.c; column <= merge.e.c; column += 1) {
          mergeByAddress.set(XLSX.utils.encode_cell({ r: row, c: column }), mergeRange);
        }
      }
    });

    const matrix = Array.from({ length: rowCount }, () =>
      Array.from({ length: columnCount }, () => ""),
    );
    const cells: RawCell[] = [];
    let hasFormula = false;
    let hasHidden = false;

    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        const cell = sheet[address];
        const rowHidden = Boolean(sheet["!rows"]?.[row]?.hidden);
        const columnHidden = Boolean(sheet["!cols"]?.[column]?.hidden);
        const hidden = rowHidden || columnHidden;
        hasHidden ||= hidden;
        const displayValue = cell ? XLSX.utils.format_cell(cell) : "";
        matrix[row - range.s.r][column - range.s.c] = displayValue;
        if (!cell && !hidden && !mergeByAddress.has(address)) continue;
        hasFormula ||= Boolean(cell?.f);
        cells.push({
          cellId: createId("cell"),
          sheet: sheetName,
          row: row - range.s.r,
          column: column - range.s.c,
          address,
          rawValue: cell?.v ?? null,
          displayValue,
          formula: cell?.f ?? null,
          dataType: cell?.t ?? "blank",
          numberFormat: cell?.z ?? null,
          style: cell?.s ? { styleIndex: cell.s } : null,
          comment:
            cell?.c
              ?.map((comment: { t?: string }) => comment.t ?? "")
              .filter(Boolean)
              .join("\n") ?? null,
          mergedRange: mergeByAddress.get(address) ?? null,
          hidden,
          bbox: null,
          ocrText: null,
          ocrConfidence: null,
        });
      }
    }

    tables.push({
      tableId: createId("table"),
      name: sheetName,
      sourceType,
      sheet: sheetName,
      matrix,
      cells,
      warnings: [
        ...(hasFormula ? ["检测到公式；仅保留公式与缓存显示值，不执行计算。"] : []),
        ...(hasHidden ? ["检测到隐藏行或列；数据已保留并标记。"] : []),
        ...(sourceType === "xlsm" ? ["宏已隔离，未执行。"] : []),
      ],
    });
  });

  if (!tables.length) throw new Error("WORKBOOK_PARSE_FAILED");
  return tables;
}
