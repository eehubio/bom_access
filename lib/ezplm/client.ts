import { createHmac, randomUUID } from "node:crypto";
import type { DigiKeyEnrichmentMatch, DigiKeyEnrichmentRequestLine } from "@/lib/digikey/types";

const BASE_URL = "https://www.ezplm.cn";
const PATH = "/api/v1/api-key/parts";

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params).filter(([, value]) => value).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
}

export function isEzplmConfigured(): boolean {
  return Boolean(process.env.EZPLM_API_KEY?.trim());
}

export async function lookupEzplm(line: DigiKeyEnrichmentRequestLine): Promise<DigiKeyEnrichmentMatch | null> {
  const apiKey = process.env.EZPLM_API_KEY?.trim();
  const keyword = line.manufacturerPartNumber ?? line.searchQuery;
  if (!apiKey || !keyword || line.isPassive) return null;
  const params = { keyword, pageSize: "10" };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const canonical = ["GET", PATH, canonicalQuery(params), timestamp, nonce].join("\n");
  const signature = createHmac("sha256", apiKey).update(canonical).digest("base64url");
  const response = await fetch(`${BASE_URL}${PATH}?${canonicalQuery(params)}`, { headers: { "X-API-Key": apiKey, "X-Timestamp": timestamp, "X-Nonce": nonce, "X-Signature": signature }, cache: "no-store" });
  if (!response.ok) return null;
  const data = (await response.json() as { data?: unknown }).data;
  const parts = Array.isArray(data) ? data.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object")) : [];
  const normalized = keyword.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const part = parts.find((candidate) => clean(candidate.mpn)?.replace(/[^a-z0-9]/gi, "").toUpperCase() === normalized) ?? parts[0];
  const mpn = clean(part?.mpn);
  if (!part || !mpn) return null;
  const exact = mpn.replace(/[^a-z0-9]/gi, "").toUpperCase() === normalized;
  return { lineId: line.lineId, queriedManufacturerPartNumber: keyword, matchedManufacturerPartNumber: mpn, manufacturer: clean(part.manufacturer), package: clean(part.footprint), description: clean(part.description) ?? clean(part.name), digiKeyProductNumber: clean(part.id), productUrl: clean(part.pdf), unitPrice: null, currency: "USD", confidence: exact ? 0.99 : 0.78, matchType: exact ? "exact_mpn" : "candidate", source: "ezplm_parts_api" };
}
