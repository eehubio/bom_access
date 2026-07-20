import { detectHeader, mapColumns } from "./mapping";
import { parseQuantity } from "./quantity";
import { parseReferenceDesignators } from "./refdes";
import type {
  CanonicalBomLine,
  CanonicalField,
  ColumnMapping,
  FieldEvidence,
  LineType,
  NormalizationResult,
  NormalizedText,
  RawCell,
  RawDocument,
  RawFieldDictionaryEntry,
  RawTable,
  ReviewIssue,
} from "./types";
import {
  cleanText,
  columnLabel,
  createId,
  geometricMean,
  rounded,
  searchKey,
} from "./utils";

const AGENT_VERSION = "1.0.0" as const;
const DNP_TERMS = /^(?:x|yes|y|true|1|dnp|dni|dnm|nf|np|not fitted|not populated|do not place|不装|不贴|空贴|选配)$/i;

function textValue(raw: unknown): NormalizedText | null {
  const normalized = cleanText(raw);
  return normalized ? { raw: String(raw ?? ""), normalized } : null;
}

function cellLookup(table: RawTable): Map<string, RawCell> {
  return new Map(table.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
}

function getEntry(
  row: string[],
  mappings: ColumnMapping[],
  field: CanonicalField,
): { value: string; mapping: ColumnMapping } | null {
  const mapping = mappings.find(
    (item) => item.targetField === field && (!item.variantName || field !== "quantity"),
  ) ?? mappings.find((item) => item.targetField === field);
  if (!mapping) return null;
  return { value: row[mapping.sourceColumn] ?? "", mapping };
}

function makeEvidence(
  document: RawDocument,
  table: RawTable,
  rowIndex: number,
  entry: { value: string; mapping: ColumnMapping },
  cells: Map<string, RawCell>,
): FieldEvidence {
  const cell = cells.get(`${rowIndex}:${entry.mapping.sourceColumn}`);
  return {
    evidenceId: createId("evidence"),
    sourceAssetId: document.asset.assetId,
    tableId: table.tableId,
    sheet: cell?.sheet ?? table.sheet,
    page: cell?.page ?? table.page,
    row: rowIndex + 1,
    column: entry.mapping.sourceColumn + 1,
    cellAddress: cell?.address ?? `${columnLabel(entry.mapping.sourceColumn)}${rowIndex + 1}`,
    rawHeader: entry.mapping.headerRaw,
    headerPath: entry.mapping.headerPath,
    rawValue: cell?.rawValue ?? entry.value,
    displayValue: cell?.displayValue ?? entry.value,
    bbox: cell?.bbox ?? null,
    adapter: table.sourceType,
    parserVersion: `${table.sourceType}-1.0.0`,
    mappingRule: entry.mapping.mappingRule,
  };
}

function classifyLine(row: string[], entries: Partial<Record<CanonicalField, string>>): LineType | "skip" {
  const populated = row.filter((value) => cleanText(value)).length;
  if (!populated) return "skip";
  const joined = row.join(" ").toLowerCase();
  if (/^(total|subtotal|合计|小计)/i.test(cleanText(joined))) return "subtotal";
  if (/^(note|remark|备注|说明)[:：]?/i.test(cleanText(joined))) return "note";
  if (/pcb\s*fab|printed circuit board|裸板|线路板/.test(joined)) return "pcb";
  if (/firmware|固件/.test(joined)) return "firmware";
  if (/assembly labor|labor|工时|人工/.test(joined)) return "labor";
  if (/package|packaging|包装盒|纸箱/.test(joined) && !entries.manufacturer_part_number) return "packaging";
  if (/screw|washer|standoff|螺丝|螺母|垫片/.test(joined)) return "mechanical";
  if (/glue|adhesive|solder paste|胶水|锡膏/.test(joined)) return "consumable";
  if (/subassembly|子装配|组件/.test(joined) && !entries.reference_designators) return "subassembly";
  if (
    populated <= 2 &&
    !entries.quantity &&
    !entries.manufacturer_part_number &&
    !entries.internal_part_number &&
    !entries.reference_designators
  ) {
    return "group_header";
  }
  if (
    entries.reference_designators ||
    entries.manufacturer_part_number ||
    entries.internal_part_number ||
    entries.quantity
  ) {
    return "component";
  }
  return "unknown";
}

function mappingEntries(row: string[], mappings: ColumnMapping[]): Partial<Record<CanonicalField, string>> {
  const entries: Partial<Record<CanonicalField, string>> = {};
  mappings.forEach((mapping) => {
    if (mapping.targetField && entries[mapping.targetField] === undefined) {
      entries[mapping.targetField] = row[mapping.sourceColumn] ?? "";
    }
  });
  return entries;
}

function isRepeatedHeader(row: string[], mappings: ColumnMapping[]): boolean {
  const populatedMappings = mappings.filter((mapping) => mapping.targetField);
  if (!populatedMappings.length) return false;
  const matches = populatedMappings.filter((mapping) => {
    const value = cleanText(row[mapping.sourceColumn]).toLowerCase();
    return value === cleanText(mapping.headerRaw).toLowerCase();
  }).length;
  return matches / populatedMappings.length >= 0.6;
}

function buildRawFields(row: string[], mappings: ColumnMapping[]): CanonicalBomLine["rawFields"] {
  const rawFields: CanonicalBomLine["rawFields"] = {};
  mappings.forEach((mapping) => {
    if (mapping.targetField) return;
    const value = row[mapping.sourceColumn] ?? "";
    if (!cleanText(value)) return;
    rawFields[mapping.headerRaw] = {
      value,
      displayValue: value,
      sourceColumn: mapping.sourceColumnLabel,
      headerRaw: mapping.headerRaw,
    };
  });
  return rawFields;
}

function determineDnp(raw: string, notes: string, quantity: string | null): { dnp: boolean; reason: string | null } {
  if (DNP_TERMS.test(cleanText(raw))) return { dnp: true, reason: "explicit_dnp_column" };
  if (/\b(?:dnp|dni|dnm|not fitted|not populated|do not place)\b|不装|不贴|空贴/i.test(notes)) {
    return { dnp: true, reason: "notes_signal" };
  }
  if (quantity === "0") return { dnp: false, reason: null };
  return { dnp: false, reason: null };
}

function parseMpn(raw: string): CanonicalBomLine["part"]["manufacturerPartNumber"] {
  const normalized = cleanText(raw);
  if (!normalized) return null;
  const candidates = normalized.split(/\s+(?:\/|;)\s+/).filter(Boolean);
  const primary = candidates[0] ?? normalized;
  return {
    raw,
    normalized: primary,
    searchKey: searchKey(primary),
    alternateCandidates: candidates.slice(1),
  };
}

function variantRules(row: string[], mappings: ColumnMapping[]): CanonicalBomLine["assembly"]["variantRules"] {
  return mappings
    .filter((mapping) => mapping.targetField === "quantity" && mapping.variantName)
    .map((mapping) => {
      const parsed = parseQuantity(row[mapping.sourceColumn] ?? "");
      return {
        variant: mapping.variantName ?? "UNKNOWN",
        included: parsed.value !== "0" && parsed.kind !== "empty",
        quantity: parsed.value,
        reason: parsed.value === "0" ? "variant_quantity_zero" : undefined,
      };
    });
}

function normalizeLine(
  document: RawDocument,
  table: RawTable,
  row: string[],
  rowIndex: number,
  mappings: ColumnMapping[],
  cells: Map<string, RawCell>,
  reviewItems: ReviewIssue[],
): CanonicalBomLine | null {
  if (isRepeatedHeader(row, mappings)) return null;
  const entries = mappingEntries(row, mappings);
  const lineType = classifyLine(row, entries);
  if (lineType === "skip") return null;

  const evidence: CanonicalBomLine["evidence"] = {};
  const confidence: CanonicalBomLine["confidence"] = {};
  const evidenceFor = (field: CanonicalField) => {
    const entry = getEntry(row, mappings, field);
    if (!entry) return null;
    evidence[field] = makeEvidence(document, table, rowIndex, entry, cells);
    confidence[field] = entry.mapping.confidence;
    return entry.value;
  };

  const refdesRaw = evidenceFor("reference_designators") ?? "";
  const refdes = parseReferenceDesignators(refdesRaw);
  const quantityRaw = evidenceFor("quantity") ?? "";
  const quantity = parseQuantity(quantityRaw);
  const notes = evidenceFor("notes") ?? "";
  const dnpRaw = evidenceFor("dnp") ?? "";
  const dnp = determineDnp(dnpRaw, notes, quantity.value);
  const lineId = createId("line");
  const issues: string[] = [];

  const addIssue = (
    reasonCode: string,
    title: string,
    detail: string,
    severity: ReviewIssue["severity"] = "warning",
  ) => {
    issues.push(reasonCode);
    reviewItems.push({
      reviewId: createId("review"),
      severity,
      reasonCode,
      title,
      detail,
      lineId,
      status: "open",
    });
  };

  refdes.errors.forEach((error) => addIssue("REFDES_PARSE_FAILED", "位号解析异常", error));
  if (quantity.kind === "invalid") {
    addIssue("QUANTITY_PARSE_FAILED", "数量格式无法识别", `原始值：${quantityRaw}`, "blocking");
  }
  if (
    lineType === "component" &&
    quantity.value !== null &&
    refdes.physicalCount > 0 &&
    Number(quantity.value) !== refdes.physicalCount &&
    !dnp.dnp
  ) {
    addIssue(
      "QUANTITY_REFDES_MISMATCH",
      "数量与位号不一致",
      `Qty=${quantity.value}，位号计数=${refdes.physicalCount}`,
      "blocking",
    );
  }
  if (quantity.value === "0" && !dnp.dnp) {
    addIssue("QTY_ZERO_REQUIRES_REVIEW", "数量为 0", "Qty=0 不会自动判定为 DNP，需要人工确认。");
  }

  const mpnRaw = evidenceFor("manufacturer_part_number") ?? "";
  const mpn = parseMpn(mpnRaw);
  if (mpn && mpn.alternateCandidates.length) {
    addIssue("MPN_AMBIGUOUS", "单元格包含多个型号", `候选：${[mpn.normalized, ...mpn.alternateCandidates].join("、")}`);
  }

  const ambiguousMappings = mappings.filter(
    (mapping) => mapping.reviewStatus === "review_required" && cleanText(row[mapping.sourceColumn]),
  );
  ambiguousMappings.forEach((mapping) =>
    addIssue(
      "HEADER_MAPPING_AMBIGUOUS",
      "列映射需要确认",
      `${mapping.headerRaw} → ${mapping.targetField ?? "未映射"} (${Math.round(mapping.confidence * 100)}%)`,
    ),
  );

  const resolvedQuantity =
    quantity.value ??
    (quantity.kind === "empty" && refdes.physicalCount > 0 ? String(refdes.physicalCount) : null);
  const quantitySource = quantity.value
    ? "explicit"
    : refdes.physicalCount > 0
      ? "inferred_from_refdes"
      : "unknown";

  const line: CanonicalBomLine = {
    lineId,
    sourceRowId: createId("row"),
    sourceRowNumber: rowIndex + 1,
    lineNumber: cleanText(evidenceFor("line_number")) || null,
    lineType,
    hierarchy: {
      level: Number.parseInt(cleanText(evidenceFor("level")), 10) || 0,
      parentLineId: null,
      isPhantom: false,
    },
    referenceDesignators: {
      raw: refdesRaw,
      normalized: refdes.normalized,
      physicalCount: refdes.physicalCount,
      logicalUnits: refdes.logicalUnits,
    },
    quantity: {
      raw: quantityRaw,
      perAssembly: resolvedQuantity,
      total: null,
      unit: quantity.unit,
      source: quantitySource,
    },
    part: {
      internalPartNumber: textValue(evidenceFor("internal_part_number")),
      customerPartNumber: textValue(evidenceFor("customer_part_number")),
      manufacturer: textValue(evidenceFor("manufacturer")),
      manufacturerPartNumber: mpn,
    },
    engineering: {
      description: textValue(evidenceFor("description")),
      value: textValue(evidenceFor("value")),
      tolerance: textValue(evidenceFor("tolerance")),
      voltageRating: textValue(evidenceFor("voltage_rating")),
      currentRating: textValue(evidenceFor("current_rating")),
      powerRating: textValue(evidenceFor("power_rating")),
      package: textValue(evidenceFor("package")),
      footprint: textValue(evidenceFor("footprint")),
      category: cleanText(evidenceFor("category")) || null,
    },
    sourcing: {
      supplier: textValue(evidenceFor("supplier")),
      supplierSku: textValue(evidenceFor("supplier_sku")),
      alternatePart: textValue(evidenceFor("alternate_part")),
    },
    assembly: {
      dnp: dnp.dnp,
      dnpReason: dnp.reason,
      variantRules: variantRules(row, mappings),
    },
    commercial: {
      unitPrice: textValue(evidenceFor("unit_price")),
      currency: textValue(evidenceFor("currency")),
      moq: textValue(evidenceFor("moq")),
      leadTime: textValue(evidenceFor("lead_time")),
    },
    notes: notes ? [notes] : [],
    rawFields: buildRawFields(row, mappings),
    evidence,
    confidence,
    issues,
    reviewStatus: issues.some((issue) => issue !== "QTY_ZERO_REQUIRES_REVIEW")
      ? "review_required"
      : issues.length
        ? "review_required"
        : "auto_approved",
  };
  const scores = Object.values(confidence).filter((value): value is number => typeof value === "number");
  line.confidence.overall = rounded(geometricMean(scores.length ? scores : [0.55]));
  return line;
}

function linkHierarchy(lines: CanonicalBomLine[]): void {
  const stack = new Map<number, string>();
  lines.forEach((line) => {
    const level = line.hierarchy.level;
    line.hierarchy.parentLineId = level > 0 ? stack.get(level - 1) ?? null : null;
    stack.set(level, line.lineId);
    Array.from(stack.keys())
      .filter((key) => key > level)
      .forEach((key) => stack.delete(key));
  });
}

function detectDuplicateRefdes(lines: CanonicalBomLine[], reviewItems: ReviewIssue[]): void {
  const seen = new Map<string, CanonicalBomLine>();
  lines.forEach((line) => {
    if (line.assembly.dnp) return;
    line.referenceDesignators.normalized.forEach((refdes) => {
      const key = `${line.hierarchy.level}:${refdes}`;
      const previous = seen.get(key);
      if (!previous) {
        seen.set(key, line);
        return;
      }
      const reasonCode = "DUPLICATE_REFDES";
      line.issues.push(reasonCode);
      previous.issues.push(reasonCode);
      line.reviewStatus = "review_required";
      previous.reviewStatus = "review_required";
      reviewItems.push({
        reviewId: createId("review"),
        severity: "blocking",
        reasonCode,
        title: `重复位号 ${refdes}`,
        detail: `源行 ${previous.sourceRowNumber} 与 ${line.sourceRowNumber} 在同一层级使用了相同位号。`,
        lineId: line.lineId,
        status: "open",
      });
    });
  });
}

function buildRawFieldDictionary(
  table: RawTable,
  mappings: ColumnMapping[],
  dataStartRow: number,
): RawFieldDictionaryEntry[] {
  return mappings.map((mapping) => {
    const values = table.matrix
      .slice(dataStartRow)
      .map((row) => cleanText(row[mapping.sourceColumn]))
      .filter(Boolean);
    return {
      headerRaw: mapping.headerRaw,
      standardField: mapping.targetField,
      occurrences: values.length,
      samples: Array.from(new Set(values)).slice(0, 5),
      mappingRule: mapping.mappingRule,
      confidence: mapping.confidence,
      unmappedReason: mapping.targetField ? null : "no_reliable_semantic_match",
    };
  });
}

function scoreTable(table: RawTable): number {
  const detection = detectHeader(table);
  const mappings = mapColumns(table, detection.headerRows, detection.dataStartRow);
  const mapped = mappings.filter((mapping) => mapping.targetField).length;
  const core = mappings.filter((mapping) =>
    ["reference_designators", "quantity", "manufacturer_part_number", "internal_part_number"].includes(
      mapping.targetField ?? "",
    ),
  ).length;
  return rounded(Math.min(0.99, detection.confidence * 0.45 + Math.min(mapped / 6, 1) * 0.25 + Math.min(core / 3, 1) * 0.3));
}

export function normalizeDocument(document: RawDocument): NormalizationResult {
  if (!document.tables.length) throw new Error("BOM_TABLE_NOT_FOUND");
  const rankedTables = document.tables
    .map((table) => ({ table, score: scoreTable(table) }))
    .sort((left, right) => right.score - left.score);
  const table = rankedTables[0].table;
  const tableScore = rankedTables[0].score;
  const detection = detectHeader(table);
  table.headerRows = detection.headerRows;
  table.dataStartRow = detection.dataStartRow;
  table.confidence = tableScore;
  const mappings = mapColumns(table, detection.headerRows, detection.dataStartRow);
  const reviewItems: ReviewIssue[] = [];
  const cells = cellLookup(table);
  const lines = table.matrix
    .slice(detection.dataStartRow)
    .map((row, offset) =>
      normalizeLine(
        document,
        table,
        row,
        detection.dataStartRow + offset,
        mappings,
        cells,
        reviewItems,
      ),
    )
    .filter((line): line is CanonicalBomLine => Boolean(line));

  linkHierarchy(lines);
  detectDuplicateRefdes(lines, reviewItems);

  mappings
    .filter((mapping) => mapping.reviewStatus !== "auto_approved")
    .forEach((mapping) => {
      reviewItems.push({
        reviewId: createId("review"),
        severity: mapping.reviewStatus === "unmapped" ? "info" : "warning",
        reasonCode: mapping.reviewStatus === "unmapped" ? "UNMAPPED_COLUMN" : "HEADER_MAPPING_AMBIGUOUS",
        title: mapping.reviewStatus === "unmapped" ? `未映射列：${mapping.headerRaw}` : `确认列映射：${mapping.headerRaw}`,
        detail: mapping.targetField
          ? `当前映射到 ${mapping.targetField}，置信度 ${Math.round(mapping.confidence * 100)}%。`
          : "该列已完整保留在 raw_fields，未自动映射到 Canonical Schema。",
        column: mapping.sourceColumn,
        status: "open",
      });
    });

  if (rankedTables[1] && tableScore - rankedTables[1].score < 0.08) {
    reviewItems.push({
      reviewId: createId("review"),
      severity: "blocking",
      reasonCode: "MULTIPLE_BOM_TABLES_AMBIGUOUS",
      title: "存在多个高分 BOM 表候选",
      detail: `${table.name} 与 ${rankedTables[1].table.name} 的检测分数接近，需要确认。`,
      status: "open",
    });
  }

  const mappedColumns = mappings.filter((mapping) => mapping.targetField);
  const columnScore = mappedColumns.length
    ? mappedColumns.reduce((sum, mapping) => sum + mapping.confidence, 0) / mappedColumns.length
    : 0;
  const dataLines = lines.filter((line) => line.lineType === "component");
  const covered = dataLines.filter(
    (line) =>
      line.quantity.perAssembly &&
      (line.part.manufacturerPartNumber || line.part.internalPartNumber || line.engineering.description),
  ).length;
  const requiredCoverage = dataLines.length ? covered / dataLines.length : 0;
  const normalizedRows = lines.filter((line) => !line.issues.length).length;
  const rowScore = lines.length ? normalizedRows / lines.length : 0;
  const evidenceFields = lines.reduce(
    (sum, line) => sum + Object.values(line.evidence).filter(Boolean).length,
    0,
  );
  const populatedMappedFields = lines.reduce((sum, line) => {
    return sum + Object.values(line.evidence).filter(Boolean).length;
  }, 0);
  const evidenceCompleteness = populatedMappedFields ? evidenceFields / populatedMappedFields : 1;
  const overall = rounded(
    geometricMean(
      [tableScore, columnScore || 0.4, requiredCoverage || 0.4, rowScore || 0.4, evidenceCompleteness],
      [1.3, 1.4, 1.5, 1.2, 1.5],
    ),
  );
  const blocking = reviewItems.some((item) => item.severity === "blocking" && item.status === "open");
  const reviewRequired = blocking || mappings.some((mapping) => mapping.reviewStatus === "review_required");
  const reviewReasons = Array.from(
    new Set(reviewItems.filter((item) => item.severity !== "info").map((item) => item.reasonCode)),
  );

  return {
    agentId: "bom-intake-normalization",
    agentVersion: AGENT_VERSION,
    jobId: createId("job"),
    resultId: createId("result"),
    status: reviewRequired ? "review_required" : "completed",
    source: document.asset,
    selectedTableId: table.tableId,
    table,
    headerRows: detection.headerRows,
    columnMappings: mappings,
    lines,
    rawFieldDictionary: buildRawFieldDictionary(table, mappings, detection.dataStartRow),
    reviewItems,
    quality: {
      tableDetectionScore: tableScore,
      columnMappingScore: rounded(columnScore),
      requiredFieldCoverage: rounded(requiredCoverage),
      rowNormalizationScore: rounded(rowScore),
      evidenceCompleteness: rounded(evidenceCompleteness),
      overallScore: overall,
      reviewRequired,
      reviewReasons,
    },
    summary: {
      sourceRows: Math.max(0, table.matrix.length - detection.dataStartRow),
      canonicalLines: lines.length,
      componentLines: dataLines.length,
      dnpLines: lines.filter((line) => line.assembly.dnp).length,
      unmappedColumns: mappings.filter((mapping) => !mapping.targetField).length,
      reviewItems: reviewItems.filter((item) => item.status === "open").length,
    },
    event: {
      eventType: reviewRequired ? "bom.normalization.review_required" : "bom.normalized.ready",
      eventVersion: "1.0",
      createdAt: new Date().toISOString(),
    },
  };
}
