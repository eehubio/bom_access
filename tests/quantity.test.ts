import { describe, expect, it } from "vitest";
import { parseQuantity } from "@/lib/bom/quantity";

describe("parseQuantity", () => {
  it("keeps decimals as strings", () => {
    expect(parseQuantity("1,000.0")).toMatchObject({ value: "1000", kind: "numeric" });
  });

  it("does not coerce blank to zero", () => {
    expect(parseQuantity("")).toMatchObject({ value: null, kind: "empty" });
  });

  it("recognizes as-required quantities", () => {
    expect(parseQuantity("A/R")).toMatchObject({ value: null, kind: "as_required" });
  });
});
