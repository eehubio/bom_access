import { describe, expect, it } from "vitest";
import { safeSpreadsheetValue } from "@/lib/bom/utils";

describe("safeSpreadsheetValue", () => {
  it.each(["=SUM(A1:A2)", "+cmd", "-1+2", "@user"])("neutralizes %s", (value) => {
    expect(safeSpreadsheetValue(value)).toBe(`'${value}`);
  });

  it("leaves ordinary MPN values untouched", () => {
    expect(safeSpreadsheetValue("STM32G431CBT6")).toBe("STM32G431CBT6");
  });
});
