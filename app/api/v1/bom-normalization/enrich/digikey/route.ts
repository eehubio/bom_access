import { NextResponse } from "next/server";
import { z } from "zod";
import { enrichWithDigiKey } from "@/lib/digikey/client";

export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string().min(1).max(128),
    manufacturerPartNumber: z.string().min(2).max(250),
    footprint: z.string().max(500).nullable().optional(),
  })).min(1).max(25),
});

export async function POST(request: Request) {
  try {
    const { lines } = requestSchema.parse(await request.json());
    return NextResponse.json(await enrichWithDigiKey(lines));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_REQUEST", details: error.issues }, { status: 400 });
    }
    const code = error instanceof Error ? error.message : "DIGIKEY_ENRICHMENT_FAILED";
    const status = code === "DIGIKEY_RATE_LIMITED" ? 429 : 502;
    return NextResponse.json({ error: code }, { status });
  }
}
