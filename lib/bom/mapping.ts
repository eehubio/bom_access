import { FIELD_ALIASES, normalizeHeader } from "./aliases";
import type { CanonicalField, ColumnMapping, RawTable } from "./types";
import { clamp, columnLabel, rounded } from "./utils";

interface HeaderDetection {
  headerRows: number[];
  dataStartRow: number;
  confidence: number;
}

function aliasScore(header: string): Array<{ field: CanonicalField; score: number; rule: string }> {
  const normalized = normalizeHeader(header);
  if (!normalized) return [];
  const headerSegments = header
    .split("/")
    .map((segment) => normalizeHeader(segment))
    .filter(Boolean);
  const scores: Array<{ field: CanonicalField; score: number; rule: string }> = [];

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as Array<
    [CanonicalField, string[]]
  >) {
    let best = 0;
    let rule = "no_match";
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      if (normalized === normalizedAlias) {
        best = Math.max(best, 0.98);
        rule = `alias_exact:${alias}`;
      } else if (headerSegments.includes(normalizedAlias)) {
        best = Math.max(best, 0.92);
        rule = `alias_header_segment:${alias}`;
      } else if (
        normalizedAlias.replace(/\s/g, "").length >= 3 &&
        (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized))
      ) {
        best = Math.max(best, 0.84);
        rule = `alias_contains:${alias}`;
      }
    }
    if (best > 0) scores.push({ field, score: best, rule });
  }
  return scores.sort((left, right) => right.score - left.score);
}

function rowHeaderScore(row: string[]): number {
  const populated = row.filter((value) => value.trim()).length;
  if (!populated) return 0;
  const aliasMatches = row.reduce((sum, value) => sum + (aliasScore(value)[0]?.score ?? 0), 0);
  const textCells = row.filter((value) => value && !/^[-+]?\d+(?:\.\d+)?$/.test(value)).length;
  const density = populated / Math.max(row.length, 1);
  return aliasMatches * 1.7 + textCells * 0.08 + density * 0.2;
}

export function detectHeader(table: RawTable): HeaderDetection {
  const candidates = table.matrix.slice(0, 12).map((row, index) => ({
    index,
    score: rowHeaderScore(row),
  }));
  const best = candidates.sort((left, right) => right.score - left.score)[0] ?? {
    index: 0,
    score: 0,
  };
  const previous = table.matrix[best.index - 1] ?? [];
  const previousPopulated = previous.filter(Boolean).length;
  const currentPopulated = (table.matrix[best.index] ?? []).filter(Boolean).length;
  const usePrevious =
    best.index > 0 &&
    previousPopulated >= 2 &&
    previousPopulated <= currentPopulated &&
    rowHeaderScore(previous) > 0.1;
  const headerRows = usePrevious ? [best.index - 1, best.index] : [best.index];
  return {
    headerRows,
    dataStartRow: best.index + 1,
    confidence: rounded(clamp(0.45 + best.score / Math.max(currentPopulated * 2.2, 1))),
  };
}

function buildHeaderPaths(table: RawTable, headerRows: number[]): string[] {
  const width = Math.max(...table.matrix.map((row) => row.length), 0);
  const carryForward: string[] = [];
  return Array.from({ length: width }, (_, column) => {
    const parts: string[] = [];
    headerRows.forEach((rowIndex, depth) => {
      const value = (table.matrix[rowIndex]?.[column] ?? "").trim();
      if (value) carryForward[depth] = value;
      const resolved = value || carryForward[depth] || "";
      if (resolved && parts[parts.length - 1] !== resolved) parts.push(resolved);
    });
    return parts.join("/");
  });
}

function inferByValues(values: string[]): Array<{ field: CanonicalField; score: number; rule: string }> {
  const nonEmpty = values.filter(Boolean);
  if (!nonEmpty.length) return [];
  const ratio = (pattern: RegExp) => nonEmpty.filter((value) => pattern.test(value)).length / nonEmpty.length;
  const candidates: Array<{ field: CanonicalField; score: number; rule: string }> = [];
  const refdesRatio = ratio(/^(?:[A-Za-z]+\d+(?:[A-Za-z])?)(?:\s*[,;~\/-]\s*[A-Za-z]*\d+(?:[A-Za-z])?)*$/);
  const numberRatio = ratio(/^\s*\d+(?:[.,]\d+)?\s*(?:pcs|ea|个|只|件)?\s*$/i);
  const currencyRatio = ratio(/^(?:[$¥€£]|CNY|USD|EUR)?\s*\d+(?:\.\d+)?$/i);
  if (refdesRatio > 0.65) candidates.push({ field: "reference_designators", score: 0.78, rule: "value_pattern:refdes" });
  if (numberRatio > 0.8) candidates.push({ field: "quantity", score: 0.58, rule: "value_pattern:numeric" });
  if (currencyRatio > 0.8) candidates.push({ field: "unit_price", score: 0.5, rule: "value_pattern:currency" });
  return candidates.sort((left, right) => right.score - left.score);
}

function detectVariantName(header: string): string | undefined {
  const match = header.match(/(?:^|\/|\s)([A-Za-z0-9_-]{1,16})\s*(?:qty|quantity|用量|数量)$/i);
  if (!match) return undefined;
  const candidate = match[1];
  if (/^(base|bom|unit|item)$/i.test(candidate)) return undefined;
  return candidate.toUpperCase();
}

export function mapColumns(
  table: RawTable,
  headerRows: number[],
  dataStartRow: number,
): ColumnMapping[] {
  const headerPaths = buildHeaderPaths(table, headerRows);
  const manufacturerPresent = headerPaths.some(
    (header) => aliasScore(header)[0]?.field === "manufacturer",
  );

  return headerPaths.map((headerPath, column) => {
    const headerRaw = headerRows
      .map((row) => table.matrix[row]?.[column] ?? "")
      .filter(Boolean)
      .join(" / ");
    const samples = table.matrix
      .slice(dataStartRow, dataStartRow + 20)
      .map((row) => row[column]?.trim() ?? "")
      .filter(Boolean)
      .slice(0, 5);
    const candidates = [...aliasScore(headerPath), ...inferByValues(samples)].sort(
      (left, right) => right.score - left.score,
    );

    if (/^(part\s*(number|no)|p\/?n)$/i.test(normalizeHeader(headerRaw))) {
      candidates.unshift(
        manufacturerPresent
          ? {
              field: "manufacturer_part_number",
              score: 0.82,
              rule: "context:part_number_with_manufacturer",
            }
          : {
              field: "internal_part_number",
              score: 0.64,
              rule: "context:ambiguous_part_number",
            },
      );
    }

    const unique = candidates.filter(
      (candidate, index) =>
        candidates.findIndex((item) => item.field === candidate.field) === index,
    );
    const best = unique[0];
    const targetField = best && best.score >= 0.5 ? best.field : null;
    const confidence = rounded(best?.score ?? 0);
    const ambiguous =
      targetField !== null &&
      (confidence < 0.8 || (unique[1] && confidence - unique[1].score < 0.12));
    return {
      sourceColumn: column,
      sourceColumnLabel: columnLabel(column),
      headerRaw: headerRaw || columnLabel(column),
      headerPath: headerPath || headerRaw || columnLabel(column),
      targetField,
      confidence,
      alternatives: unique
        .slice(1, 4)
        .map((candidate) => ({ field: candidate.field, confidence: rounded(candidate.score) })),
      mappingRule: best?.rule ?? "unmapped:no_reliable_semantic_match",
      sampleValues: samples,
      reviewStatus: !targetField ? "unmapped" : ambiguous ? "review_required" : "auto_approved",
      variantName: targetField === "quantity" ? detectVariantName(headerPath) : undefined,
    };
  });
}
