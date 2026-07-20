import { describe, expect, it } from "vitest";
import { selectDigiKeyMatch } from "@/lib/digikey/client";

describe("selectDigiKeyMatch", () => {
  it("prefers an exact manufacturer part number and extracts manufacturer plus package", () => {
    const match = selectDigiKeyMatch(
      { lineId: "line-1", manufacturerPartNumber: "TPS62160DSGR" },
      {
        Products: [
          {
            ManufacturerProductNumber: "TPS62160DSGR",
            Manufacturer: { Name: "Texas Instruments" },
            Description: { DetailedDescription: "Buck regulator" },
            DigiKeyProductNumber: "296-12345-1-ND",
            ProductUrl: "https://www.digikey.com/example",
            Parameters: [
              { Parameter: "Package / Case", ValueText: "8-WFDFN Exposed Pad" },
              { Parameter: "Mounting Type", ValueText: "Surface Mount" },
            ],
            ProductVariations: [
              { StandardPricing: [{ BreakQuantity: 1, UnitPrice: 2.32 }, { BreakQuantity: 10, UnitPrice: 1.719 }] },
            ],
          },
        ],
      },
    );

    expect(match).toMatchObject({
      manufacturer: "Texas Instruments",
      package: "8-WFDFN Exposed Pad",
      matchType: "exact_mpn",
      confidence: 0.99,
      unitPrice: 2.32,
    });
  });

  it("marks a non-exact keyword result as a candidate", () => {
    const match = selectDigiKeyMatch(
      { lineId: "line-2", manufacturerPartNumber: "CH340E" },
      { Products: [{ ManufacturerProductNumber: "CH340G", Manufacturer: { Name: "WCH" } }] },
    );

    expect(match).toMatchObject({ manufacturer: "WCH", matchType: "candidate", confidence: 0.72 });
  });
});
