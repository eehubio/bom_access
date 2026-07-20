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

  it("infers IC part numbers and packages from a compact KiCad BOM", () => {
    const result = normalizeDocument(
      fixture([
        ["Qty", "Reference(s)", "Value", "Footprint"],
        ["3", "C1, C3, C5", "1uF", "Capacitor_SMD:C_0402_1005Metric"],
        ["4", "R1, R2, R3, R4", "2k", "Resistor_SMD:R_0402_1005Metric"],
        ["1", "U1", "CH340E", "Package_SO:MSOP-10_3x3mm_P0.5mm"],
        ["1", "U2", "LPC824M201JHI33", "Package_DFN_QFN:QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm"],
        ["1", "U3", "MIC5504-3.3", "Package_TO_SOT_SMD:SOT-23-5"],
      ]),
    );

    expect(result.lines[0]).toMatchObject({
      lineType: "component",
      engineering: { value: { normalized: "1uF" }, package: { normalized: "0402 (1005 Metric)" } },
    });
    expect(result.lines[1].engineering.category).toBe("passive.resistor");
    expect(result.lines[2]).toMatchObject({
      lineType: "component",
      part: { manufacturerPartNumber: { normalized: "CH340E" } },
      engineering: { package: { normalized: "MSOP-10" } },
    });
    expect(result.lines[2].evidence.manufacturer_part_number?.mappingRule).toBe("inference:ic_refdes_value");
    expect(result.lines[3].engineering.package?.normalized).toBe("QFN-32");
    expect(result.lines[4].engineering.package?.normalized).toBe("SOT-23-5");
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
