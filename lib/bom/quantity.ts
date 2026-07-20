import { cleanText } from "./utils";

export interface QuantityResult {
  value: string | null;
  unit: string;
  kind: "numeric" | "as_required" | "reference" | "optional" | "empty" | "invalid";
}

export function parseQuantity(rawValue: unknown): QuantityResult {
  const raw = cleanText(rawValue);
  if (!raw) return { value: null, unit: "pcs", kind: "empty" };

  const lower = raw.toLowerCase();
  if (["ar", "a/r", "as required", "按需"].includes(lower)) {
    return { value: null, unit: "pcs", kind: "as_required" };
  }
  if (["ref", "reference", "参考"].includes(lower)) {
    return { value: null, unit: "pcs", kind: "reference" };
  }
  if (["optional", "option", "选配"].includes(lower)) {
    return { value: null, unit: "pcs", kind: "optional" };
  }

  const match = raw.replace(/,/g, "").match(/^([+-]?\d+(?:\.\d+)?)\s*([A-Za-z\/\u4e00-\u9fff]*)$/);
  if (!match) return { value: null, unit: "pcs", kind: "invalid" };
  const value = match[1].replace(/\.0+$/, "");
  return { value, unit: match[2] || "pcs", kind: "numeric" };
}
