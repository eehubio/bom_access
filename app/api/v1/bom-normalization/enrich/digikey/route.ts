import { NextResponse } from "next/server";
import { z } from "zod";
import { enrichWithDistributors } from "@/lib/digikey/client";

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
    return NextResponse.json(await enrichWithDistributors(lines));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "INVALID_REQUEST", details: error.issues }, { status: 400 });
    }
    const code = error instanceof Error ? error.message : "DIGIKEY_ENRICHMENT_FAILED";
    const status = code === "DIGIKEY_RATE_LIMITED" ? 429 : 502;
    const message = code === "DIGIKEY_SEARCH_UNAUTHORIZED"
      ? "DigiKey 拒绝了查询：请确认 Client ID、Client Secret 和环境变量所属环境。"
      : code === "DIGIKEY_PRODUCT_SEARCH_NOT_SUBSCRIBED"
        ? "DigiKey 应用尚未订阅 Product Information V4 / ProductSearch。"
        : code === "DIGIKEY_RATE_LIMITED"
          ? "DigiKey 查询频率已达上限，请稍后重试。"
          : "DigiKey 产品搜索暂时失败，请确认应用状态、订阅和网络后重试。";
    return NextResponse.json({ error: code, message }, { status });
  }
}
