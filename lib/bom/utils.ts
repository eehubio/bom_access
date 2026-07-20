export function createId(prefix: string): string {
  const value =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export function columnLabel(index: number): string {
  let label = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

export function cleanText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[–—−]/g, "-")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchKey(value: string): string {
  return cleanText(value).replace(/[\s./_-]+/g, "").toUpperCase();
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function geometricMean(values: number[], weights?: number[]): number {
  if (!values.length) return 0;
  const safe = values.map((value) => Math.max(0.0001, value));
  const appliedWeights = weights ?? safe.map(() => 1);
  const totalWeight = appliedWeights.reduce((sum, value) => sum + value, 0);
  const logSum = safe.reduce(
    (sum, value, index) => sum + appliedWeights[index] * Math.log(value),
    0,
  );
  return Math.exp(logSum / totalWeight);
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeSpreadsheetValue(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
