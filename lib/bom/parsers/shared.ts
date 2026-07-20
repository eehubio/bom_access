import type { RawCell, RawTable, SourceType } from "../types";
import { columnLabel, createId } from "../utils";
import { SOURCE_LIMITS } from "../security";

export function rectangularize(rows: string[][]): string[][] {
  const width = Math.min(Math.max(...rows.map((row) => row.length), 0), SOURCE_LIMITS.maxColumns);
  return rows.slice(0, SOURCE_LIMITS.maxRows).map((row) =>
    Array.from({ length: width }, (_, column) => String(row[column] ?? "")),
  );
}

export function tableFromMatrix(
  name: string,
  sourceType: SourceType,
  rows: string[][],
  options?: { sheet?: string; page?: number; warnings?: string[] },
): RawTable {
  const matrix = rectangularize(rows);
  if (matrix.length * (matrix[0]?.length ?? 0) > SOURCE_LIMITS.maxCells) {
    throw new Error("SOURCE_FILE_TOO_LARGE");
  }
  const cells: RawCell[] = [];
  matrix.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      if (!value) return;
      cells.push({
        cellId: createId("cell"),
        sheet: options?.sheet,
        page: options?.page,
        row: rowIndex,
        column: columnIndex,
        address: `${columnLabel(columnIndex)}${rowIndex + 1}`,
        rawValue: value,
        displayValue: value,
        formula: null,
        dataType: "string",
        numberFormat: null,
        style: null,
        comment: null,
        mergedRange: null,
        hidden: false,
        bbox: null,
        ocrText: sourceType === "image" ? value : null,
        ocrConfidence: null,
      });
    }),
  );
  return {
    tableId: createId("table"),
    name,
    sourceType,
    sheet: options?.sheet,
    page: options?.page,
    matrix,
    cells,
    warnings: options?.warnings ?? [],
  };
}
