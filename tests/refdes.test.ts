import { describe, expect, it } from "vitest";
import { parseReferenceDesignators } from "@/lib/bom/refdes";

describe("parseReferenceDesignators", () => {
  it("expands safe mixed ranges", () => {
    const result = parseReferenceDesignators("C1,C3-C5");
    expect(result.normalized).toEqual(["C1", "C3", "C4", "C5"]);
    expect(result.physicalCount).toBe(4);
    expect(result.errors).toEqual([]);
  });

  it("collapses logical units to one physical device", () => {
    const result = parseReferenceDesignators("U1A/U1B/U1C");
    expect(result.normalized).toEqual(["U1"]);
    expect(result.logicalUnits).toEqual(["A", "B", "C"]);
    expect(result.physicalCount).toBe(1);
  });

  it("rejects oversized ranges", () => {
    const result = parseReferenceDesignators("R1-R999", 100);
    expect(result.normalized).toEqual([]);
    expect(result.errors[0]).toContain("exceeds 100");
  });
});
