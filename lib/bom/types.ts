export type SourceType =
  | "xlsx"
  | "xlsm"
  | "xls"
  | "xlsb"
  | "csv"
  | "tsv"
  | "text"
  | "markdown"
  | "html"
  | "pdf"
  | "image";

export type CanonicalField =
  | "line_number"
  | "level"
  | "parent"
  | "reference_designators"
  | "quantity"
  | "unit"
  | "internal_part_number"
  | "customer_part_number"
  | "manufacturer"
  | "manufacturer_part_number"
  | "description"
  | "value"
  | "tolerance"
  | "voltage_rating"
  | "current_rating"
  | "power_rating"
  | "package"
  | "footprint"
  | "category"
  | "supplier"
  | "supplier_sku"
  | "alternate_part"
  | "dnp"
  | "variant"
  | "notes"
  | "unit_price"
  | "currency"
  | "moq"
  | "lead_time";

export type LineType =
  | "component"
  | "subassembly"
  | "mechanical"
  | "pcb"
  | "firmware"
  | "consumable"
  | "packaging"
  | "document"
  | "labor"
  | "service"
  | "group_header"
  | "note"
  | "subtotal"
  | "separator"
  | "unknown";

export interface SourceAsset {
  assetId: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  sourceType: SourceType;
  hasMacros: boolean;
  createdAt: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawCell {
  cellId: string;
  sheet?: string;
  page?: number;
  row: number;
  column: number;
  address: string;
  rawValue: unknown;
  displayValue: string;
  formula: string | null;
  dataType: string;
  numberFormat: string | null;
  style: Record<string, unknown> | null;
  comment: string | null;
  mergedRange: string | null;
  hidden: boolean;
  bbox: BoundingBox | null;
  ocrText: string | null;
  ocrConfidence: number | null;
}

export interface RawTable {
  tableId: string;
  name: string;
  sourceType: SourceType;
  sheet?: string;
  page?: number;
  matrix: string[][];
  cells: RawCell[];
  headerRows?: number[];
  dataStartRow?: number;
  confidence?: number;
  warnings: string[];
}

export interface RawDocument {
  documentId: string;
  asset: SourceAsset;
  tables: RawTable[];
  profile: {
    candidateTables: Array<{ tableId: string; score: number }>;
    estimatedRows: number;
    languageCandidates: string[];
    hasFormulas: boolean;
    hasMergedCells: boolean;
    hasHiddenRows: boolean;
  };
  warnings: string[];
}

export interface ColumnMapping {
  sourceColumn: number;
  sourceColumnLabel: string;
  headerRaw: string;
  headerPath: string;
  targetField: CanonicalField | null;
  confidence: number;
  alternatives: Array<{ field: CanonicalField; confidence: number }>;
  mappingRule: string;
  sampleValues: string[];
  reviewStatus: "auto_approved" | "review_required" | "unmapped";
  variantName?: string;
}

export interface FieldEvidence {
  evidenceId: string;
  sourceAssetId: string;
  tableId: string;
  sheet?: string;
  page?: number;
  row: number;
  column: number;
  cellAddress: string;
  rawHeader: string;
  headerPath: string;
  rawValue: unknown;
  displayValue: string;
  bbox: BoundingBox | null;
  adapter: SourceType;
  parserVersion: string;
  mappingRule: string;
}

export interface NormalizedText {
  raw: string;
  normalized: string;
}

export interface ReviewIssue {
  reviewId: string;
  severity: "blocking" | "warning" | "info";
  reasonCode: string;
  title: string;
  detail: string;
  lineId?: string;
  column?: number;
  status: "open" | "resolved" | "ignored";
}

export interface CanonicalBomLine {
  lineId: string;
  sourceRowId: string;
  sourceRowNumber: number;
  lineNumber: string | null;
  lineType: LineType;
  hierarchy: {
    level: number;
    parentLineId: string | null;
    isPhantom: boolean;
  };
  referenceDesignators: {
    raw: string;
    normalized: string[];
    physicalCount: number;
    logicalUnits: string[];
  };
  quantity: {
    raw: string;
    perAssembly: string | null;
    total: string | null;
    unit: string;
    source: "explicit" | "inferred_from_refdes" | "unknown";
  };
  part: {
    internalPartNumber: NormalizedText | null;
    customerPartNumber: NormalizedText | null;
    manufacturer: NormalizedText | null;
    manufacturerPartNumber:
      | (NormalizedText & { searchKey: string; alternateCandidates: string[] })
      | null;
  };
  engineering: {
    description: NormalizedText | null;
    value: NormalizedText | null;
    tolerance: NormalizedText | null;
    voltageRating: NormalizedText | null;
    currentRating: NormalizedText | null;
    powerRating: NormalizedText | null;
    package: NormalizedText | null;
    footprint: NormalizedText | null;
    category: string | null;
  };
  sourcing: {
    supplier: NormalizedText | null;
    supplierSku: NormalizedText | null;
    alternatePart: NormalizedText | null;
  };
  assembly: {
    dnp: boolean;
    dnpReason: string | null;
    variantRules: Array<{
      variant: string;
      included: boolean;
      quantity: string | null;
      reason?: string;
    }>;
  };
  commercial: {
    unitPrice: NormalizedText | null;
    currency: NormalizedText | null;
    moq: NormalizedText | null;
    leadTime: NormalizedText | null;
  };
  notes: string[];
  rawFields: Record<
    string,
    { value: unknown; displayValue: string; sourceColumn: string; headerRaw: string }
  >;
  evidence: Partial<Record<CanonicalField, FieldEvidence>>;
  confidence: Partial<Record<CanonicalField | "overall", number>>;
  issues: string[];
  reviewStatus: "auto_approved" | "review_required";
}

export interface RawFieldDictionaryEntry {
  headerRaw: string;
  standardField: CanonicalField | null;
  occurrences: number;
  samples: string[];
  mappingRule: string;
  confidence: number;
  unmappedReason: string | null;
}

export interface NormalizationResult {
  agentId: "bom-intake-normalization";
  agentVersion: "1.0.0";
  jobId: string;
  resultId: string;
  status: "completed" | "review_required";
  source: SourceAsset;
  selectedTableId: string;
  table: RawTable;
  headerRows: number[];
  columnMappings: ColumnMapping[];
  lines: CanonicalBomLine[];
  rawFieldDictionary: RawFieldDictionaryEntry[];
  reviewItems: ReviewIssue[];
  quality: {
    tableDetectionScore: number;
    columnMappingScore: number;
    requiredFieldCoverage: number;
    rowNormalizationScore: number;
    evidenceCompleteness: number;
    overallScore: number;
    reviewRequired: boolean;
    reviewReasons: string[];
  };
  summary: {
    sourceRows: number;
    canonicalLines: number;
    componentLines: number;
    dnpLines: number;
    unmappedColumns: number;
    reviewItems: number;
  };
  event: {
    eventType: "bom.normalized.ready" | "bom.normalization.review_required";
    eventVersion: "1.0";
    createdAt: string;
  };
}

export interface ReviewPatch {
  patchId: string;
  targetType: "bom_line" | "column_mapping";
  targetId: string;
  baseVersion: "machine-v1";
  operations: Array<{
    op: "replace";
    path: string;
    oldValue: unknown;
    value: unknown;
  }>;
  reasonCode: string;
  createdAt: string;
}

export interface ParseProgress {
  stage: string;
  progress: number;
  detail: string;
}
