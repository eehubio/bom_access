import type { RawTable, SourceType } from "../types";
import { tableFromMatrix } from "./shared";

function parseHtml(text: string): string[][] {
  const document = new DOMParser().parseFromString(text, "text/html");
  return Array.from(document.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent?.trim() ?? ""),
  );
}

function parseMarkdown(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|") && !/^\|?\s*:?-{3,}/.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
}

function parseDelimitedText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.some((line) => line.includes("\t"))) {
    return lines.map((line) => line.split("\t").map((cell) => cell.trim()));
  }
  if (lines.some((line) => line.includes("|"))) return parseMarkdown(text);
  if (lines.every((line) => /\w+\s*[:：]\s*.+/.test(line))) {
    return [["Field", "Value"], ...lines.map((line) => line.split(/\s*[:：]\s*/, 2))];
  }
  return lines.map((line) => line.trim().split(/\s{2,}/).map((cell) => cell.trim()));
}

export function parsePastedText(text: string, requestedType?: SourceType): RawTable[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("PASTED_TEXT_EMPTY");
  const type: SourceType = requestedType ??
    (/<table[\s>]/i.test(trimmed) ? "html" : trimmed.includes("|") ? "markdown" : "text");
  const matrix = type === "html" ? parseHtml(trimmed) : parseDelimitedText(trimmed);
  if (!matrix.length) throw new Error("BOM_TABLE_NOT_FOUND");
  return [tableFromMatrix("Pasted BOM", type, matrix)];
}
