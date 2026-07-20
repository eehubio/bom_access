import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeDocument } from "@/lib/bom/normalize";
import { tableFromMatrix } from "@/lib/bom/parsers/shared";
import type { RawDocument, SourceAsset } from "@/lib/bom/types";
import { createId } from "@/lib/bom/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  source: z.object({
    type: z.literal("parsed_table"),
    filename: z.string().min(1).max(255).default("api-bom.json"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).min(2).max(100_000),
  }),
  context: z
    .object({
      project_id: z.string().optional(),
      assembly_part_number: z.string().optional(),
      assembly_revision: z.string().optional(),
      build_quantity: z.string().optional(),
    })
    .optional(),
  options: z
    .object({
      preferred_language: z.string().default("zh-CN"),
      detect_variants: z.boolean().default(true),
      detect_multilevel: z.boolean().default(true),
      preserve_hidden_rows: z.boolean().default(true),
      evaluate_formulas: z.literal(false).default(false),
    })
    .optional(),
  idempotency_key: z.string().max(128).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const rows = payload.source.rows.map((row) => row.map((value) => String(value ?? "")));
    const cellCount = rows.reduce((sum, row) => sum + row.length, 0);
    if (cellCount > 500_000) {
      return NextResponse.json({ error: "SOURCE_FILE_TOO_LARGE" }, { status: 413 });
    }
    const asset: SourceAsset = {
      assetId: createId("asset"),
      filename: payload.source.filename,
      mime: "application/json",
      size: JSON.stringify(rows).length,
      sha256: payload.source.sha256 ?? "0".repeat(64),
      sourceType: "text",
      hasMacros: false,
      createdAt: new Date().toISOString(),
    };
    const table = tableFromMatrix("API Table", "text", rows);
    const document: RawDocument = {
      documentId: createId("document"),
      asset,
      tables: [table],
      profile: {
        candidateTables: [{ tableId: table.tableId, score: 0 }],
        estimatedRows: rows.length,
        languageCandidates: [payload.options?.preferred_language ?? "zh-CN", "en"],
        hasFormulas: false,
        hasMergedCells: false,
        hasHiddenRows: false,
      },
      warnings: [],
    };
    return NextResponse.json(normalizeDocument(document));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_REQUEST", details: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    agent_id: "bom-intake-normalization",
    agent_version: "1.0.0",
    mode: "stateless",
    accepted_input: "parsed_table",
    note: "Binary files are privacy-first parsed in the browser; post the extracted matrix here for server normalization.",
  });
}
