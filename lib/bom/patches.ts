import type { CanonicalBomLine, ReviewPatch } from "./types";

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split("/").filter(Boolean);
  let cursor: Record<string, unknown> = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  });
}

export function applyReviewPatches(
  machineLines: CanonicalBomLine[],
  patches: ReviewPatch[],
): CanonicalBomLine[] {
  const byLine = new Map<string, ReviewPatch[]>();
  patches
    .filter((patch) => patch.targetType === "bom_line")
    .forEach((patch) => byLine.set(patch.targetId, [...(byLine.get(patch.targetId) ?? []), patch]));

  return machineLines.map((line) => {
    const linePatches = byLine.get(line.lineId);
    if (!linePatches?.length) return line;
    const resolved = structuredClone(line) as unknown as Record<string, unknown>;
    linePatches.forEach((patch) =>
      patch.operations.forEach((operation) => setAtPath(resolved, operation.path, operation.value)),
    );
    return resolved as unknown as CanonicalBomLine;
  });
}
