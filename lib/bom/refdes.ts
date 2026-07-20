import { cleanText } from "./utils";

export interface RefDesResult {
  normalized: string[];
  physicalCount: number;
  logicalUnits: string[];
  errors: string[];
}

const EMPTY_VALUES = new Set(["", "n/a", "na", "none", "无", "-"]);

function splitNumericRef(value: string): { prefix: string; number: number } | null {
  const match = value.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return null;
  return { prefix: match[1].toUpperCase(), number: Number(match[2]) };
}

function expandRange(token: string, maximumRange: number): string[] | null {
  const parts = token.split(/[-~]/).map((part) => part.trim());
  if (parts.length !== 2) return null;
  const start = splitNumericRef(parts[0]);
  const endWithOptionalPrefix = parts[1].match(/^([A-Za-z]+)?(\d+)$/);
  if (!start || !endWithOptionalPrefix) return null;
  const endPrefix = (endWithOptionalPrefix[1] || start.prefix).toUpperCase();
  const end = Number(endWithOptionalPrefix[2]);
  if (endPrefix !== start.prefix || end < start.number || end - start.number + 1 > maximumRange) {
    return [];
  }
  return Array.from(
    { length: end - start.number + 1 },
    (_, index) => `${start.prefix}${start.number + index}`,
  );
}

function parseLogicalUnits(token: string): { physical: string; units: string[] } | null {
  if (!token.includes("/")) return null;
  const parts = token.split("/").map((part) => part.trim());
  const matches = parts.map((part) => part.match(/^([A-Za-z]+\d+)([A-Za-z])$/));
  if (matches.some((match) => !match)) return null;
  const physical = matches[0]?.[1].toUpperCase() ?? "";
  if (!matches.every((match) => match?.[1].toUpperCase() === physical)) return null;
  return {
    physical,
    units: matches.map((match) => match?.[2].toUpperCase() ?? ""),
  };
}

export function parseReferenceDesignators(
  rawValue: unknown,
  maximumRange = 500,
): RefDesResult {
  const raw = cleanText(rawValue);
  if (EMPTY_VALUES.has(raw.toLowerCase())) {
    return { normalized: [], physicalCount: 0, logicalUnits: [], errors: [] };
  }

  const normalized: string[] = [];
  const logicalUnits: string[] = [];
  const errors: string[] = [];
  const tokens = raw
    .replace(/[，、；]/g, ",")
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const logical = parseLogicalUnits(token);
    if (logical) {
      normalized.push(logical.physical);
      logicalUnits.push(...logical.units);
      continue;
    }

    if (/[-~]/.test(token)) {
      const expanded = expandRange(token, maximumRange);
      if (expanded?.length) {
        normalized.push(...expanded);
        continue;
      }
      if (expanded?.length === 0) {
        errors.push(`RefDes range is invalid or exceeds ${maximumRange}: ${token}`);
        continue;
      }
    }

    if (/^[A-Za-z]+\d+(?:\.\d+)?(?:[A-Za-z])?$/.test(token)) {
      normalized.push(token.toUpperCase());
    } else {
      errors.push(`Unrecognized RefDes token: ${token}`);
    }
  }

  const unique = Array.from(new Set(normalized));
  return {
    normalized: unique,
    physicalCount: unique.length,
    logicalUnits: Array.from(new Set(logicalUnits)),
    errors,
  };
}
