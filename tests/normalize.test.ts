import { describe, expect, it } from "vitest";
import { normalizeDocument } from "@/lib/bom/normalize";
import { applyReviewPatches } from "@/lib/bom/patches";
import { tableFromMatrix } from "@/lib/bom/parsers/shared";
import type { RawDocument, ReviewPatch, SourceAsset } from "@/lib/bom/types";

function fixture(rows: string[][]): RawDocument {
  const asset: SourceAsset = {
    assetId: "asset-test",
    filename: "fixture.csv",
    mime: "text/csv",
    size: 100,
    sha256: "a".repeat(64),
    sourceType: "csv",
    hasMacros: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const table = tableFromMatrix("BOM", "csv", rows);
  return {
    documentId: "document-test",
    asset,
    tables: [table],
    profile: {
      candidateTables: [{ tableId: table.tableId, score: 0 }],
      estimatedRows: rows.length,
      languageCandidates: ["zh-CN"],
      hasFormulas: false,
      hasMergedCells: false,
      hasHiddenRows: false,
    },
    warnings: [],
  };
}

describe("normalizeDocument", () => {
  it("maps core fields and preserves unknown columns", () => {
    const result = normalizeDocument(
      fixture([
        ["位号", "数量", "厂商", "型号", "采购备注"],
        ["R1-R4", "4", "Yageo", "RC0402FR-0710KL", "优先国产"],
      ]),
    );
    expect(result.lines[0].referenceDesignators.normalized).toEqual(["R1", "R2", "R3", "R4"]);
    expect(result.lines[0].quantity.perAssembly).toBe("4");
    expect(result.lines[0].part.manufacturerPartNumber?.normalized).toBe("RC0402FR-0710KL");
    expect(result.lines[0].rawFields["采购备注"].displayValue).toBe("优先国产");
    expect(result.lines[0].evidence.manufacturer_part_number?.cellAddress).toBe("D2");
  });

  it("creates blocking reviews for quantity mismatch and duplicate refdes", () => {
    const result = normalizeDocument(
      fixture([
        ["位号", "数量", "型号"],
        ["R1-R2", "3", "ABC-1"],
        ["R2", "1", "ABC-2"],
      ]),
    );
    expect(result.quality.reviewRequired).toBe(true);
    expect(result.quality.reviewReasons).toContain("QUANTITY_REFDES_MISMATCH");
    expect(result.quality.reviewReasons).toContain("DUPLICATE_REFDES");
  });

  it("keeps machine record immutable when applying a patch", () => {
    const result = normalizeDocument(
      fixture([
        ["位号", "数量", "型号"],
        ["U1", "1", "TPS62I60DSG"],
      ]),
    );
    const patch: ReviewPatch = {
      patchId: "patch-1",
      targetType: "bom_line",
      targetId: result.lines[0].lineId,
      baseVersion: "machine-v1",
      operations: [
        {
          op: "replace",
          path: "/part/manufacturerPartNumber/normalized",
          oldValue: "TPS62I60DSG",
          value: "TPS62160DSG",
        },
      ],
      reasonCode: "ocr_character_confusion",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const resolved = applyReviewPatches(result.lines, [patch]);
    expect(result.lines[0].part.manufacturerPartNumber?.normalized).toBe("TPS62I60DSG");
    expect(resolved[0].part.manufacturerPartNumber?.normalized).toBe("TPS62160DSG");
  });
});
