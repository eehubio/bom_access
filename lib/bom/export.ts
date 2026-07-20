import type { NormalizationResult, ReviewPatch } from "./types";
import { safeSpreadsheetValue } from "./utils";

function quoteCsv(value: unknown): string {
  const safe = safeSpreadsheetValue(value).replace(/"/g, '""');
  return `"${safe}"`;
}

export function resultToCsv(result: NormalizationResult): string {
  const headers = [
    "Line",
    "Level",
    "RefDes",
    "Qty",
    "Unit",
    "Internal PN",
    "Manufacturer",
    "MPN",
    "Description",
    "Value",
    "Package",
    "DNP",
    "Variant",
    "Review Status",
  ];
  const rows = result.lines.map((line) => [
    line.lineNumber ?? "",
    line.hierarchy.level,
    line.referenceDesignators.normalized.join(", "),
    line.quantity.perAssembly ?? "",
    line.quantity.unit,
    line.part.internalPartNumber?.normalized ?? "",
    line.part.manufacturer?.normalized ?? "",
    line.part.manufacturerPartNumber?.normalized ?? "",
    line.engineering.description?.normalized ?? "",
    line.engineering.value?.normalized ?? "",
    line.engineering.package?.normalized ?? "",
    line.assembly.dnp ? "TRUE" : "FALSE",
    line.assembly.variantRules.map((rule) => `${rule.variant}:${rule.quantity ?? (rule.included ? "Y" : "N")}`).join("; "),
    line.reviewStatus,
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(quoteCsv).join(",")).join("\r\n")}`;
}

export function resultToJson(result: NormalizationResult, patches: ReviewPatch[]): string {
  return JSON.stringify(
    {
      machine_record: result,
      approved_patches: patches,
      export_metadata: {
        exported_at: new Date().toISOString(),
        schema_version: "1.0.0",
        note: "machine_record remains immutable; patches create the resolved view",
      },
    },
    null,
    2,
  );
}

export function downloadArtifact(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
