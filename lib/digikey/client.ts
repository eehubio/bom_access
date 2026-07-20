import type {
  DigiKeyEnrichmentMatch,
  DigiKeyEnrichmentRequestLine,
  DigiKeyEnrichmentResponse,
} from "./types";

type DigiKeyProduct = {
  ManufacturerProductNumber?: unknown;
  Manufacturer?: { Name?: unknown };
  Description?: { ProductDescription?: unknown; DetailedDescription?: unknown };
  DigiKeyProductNumber?: unknown;
  ProductUrl?: unknown;
  Parameters?: Array<{ Parameter?: unknown; ValueText?: unknown; Value?: unknown }>;
};

type TokenCache = { accessToken: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function comparable(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function packageFromParameters(product: DigiKeyProduct): string | null {
  const packageParameter = product.Parameters?.find((parameter) => {
    const name = clean(parameter.Parameter)?.toLowerCase() ?? "";
    return /^(package \/ case|supplier device package|device package|package)$/.test(name);
  });
  return clean(packageParameter?.ValueText) ?? clean(packageParameter?.Value);
}

export function selectDigiKeyMatch(
  line: DigiKeyEnrichmentRequestLine,
  payload: unknown,
): DigiKeyEnrichmentMatch | null {
  const response = payload as { ExactMatches?: unknown; Products?: unknown };
  const exactMatches = Array.isArray(response.ExactMatches) ? response.ExactMatches : [];
  const products = Array.isArray(response.Products) ? response.Products : [];
  const candidates = [...exactMatches, ...products].filter(
    (candidate): candidate is DigiKeyProduct => Boolean(candidate && typeof candidate === "object"),
  );
  const exact = candidates.find(
    (candidate) => comparable(clean(candidate.ManufacturerProductNumber) ?? "") === comparable(line.manufacturerPartNumber),
  );
  const product = exact ?? candidates[0];
  if (!product) return null;

  const matchedManufacturerPartNumber = clean(product.ManufacturerProductNumber);
  if (!matchedManufacturerPartNumber) return null;
  return {
    lineId: line.lineId,
    queriedManufacturerPartNumber: line.manufacturerPartNumber,
    matchedManufacturerPartNumber,
    manufacturer: clean(product.Manufacturer?.Name),
    package: packageFromParameters(product),
    description: clean(product.Description?.DetailedDescription) ?? clean(product.Description?.ProductDescription),
    digiKeyProductNumber: clean(product.DigiKeyProductNumber),
    productUrl: clean(product.ProductUrl),
    confidence: exact ? 0.99 : 0.72,
    matchType: exact ? "exact_mpn" : "candidate",
    source: "digikey_product_search_v4",
  };
}

function config() {
  const clientId = process.env.DIGIKEY_CLIENT_ID;
  const clientSecret = process.env.DIGIKEY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const sandbox = process.env.DIGIKEY_USE_SANDBOX === "true";
  return {
    clientId,
    clientSecret,
    baseUrl: sandbox ? "https://sandbox-api.digikey.com" : "https://api.digikey.com",
    site: process.env.DIGIKEY_LOCALE_SITE ?? "US",
    language: process.env.DIGIKEY_LOCALE_LANGUAGE ?? "en",
    currency: process.env.DIGIKEY_LOCALE_CURRENCY ?? "USD",
  };
}

async function accessToken(settings: NonNullable<ReturnType<typeof config>>): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.accessToken;
  const body = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    grant_type: "client_credentials",
  });
  const response = await fetch(`${settings.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = clean(payload?.access_token);
  if (!response.ok || !token) throw new Error("DIGIKEY_AUTH_FAILED");
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : 600;
  tokenCache = { accessToken: token, expiresAt: Date.now() + Math.max(30, expiresIn - 30) * 1000 };
  return token;
}

async function lookup(
  line: DigiKeyEnrichmentRequestLine,
  settings: NonNullable<ReturnType<typeof config>>,
): Promise<DigiKeyEnrichmentMatch | null> {
  const token = await accessToken(settings);
  const response = await fetch(`${settings.baseUrl}/products/v4/search/keyword`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-DIGIKEY-Client-Id": settings.clientId,
      "X-DIGIKEY-Locale-Site": settings.site,
      "X-DIGIKEY-Locale-Language": settings.language,
      "X-DIGIKEY-Locale-Currency": settings.currency,
    },
    body: JSON.stringify({ Keywords: line.manufacturerPartNumber, Limit: 5, Offset: 0 }),
    cache: "no-store",
  });
  if (response.status === 429) throw new Error("DIGIKEY_RATE_LIMITED");
  if (!response.ok) throw new Error("DIGIKEY_SEARCH_FAILED");
  return selectDigiKeyMatch(line, await response.json());
}

export async function enrichWithDigiKey(
  lines: DigiKeyEnrichmentRequestLine[],
): Promise<DigiKeyEnrichmentResponse> {
  const settings = config();
  if (!settings) {
    return {
      configured: false,
      matches: [],
      unmatchedLineIds: lines.map((line) => line.lineId),
      message: "请在 Vercel 配置 DIGIKEY_CLIENT_ID 和 DIGIKEY_CLIENT_SECRET 后重试。",
    };
  }
  const matches: DigiKeyEnrichmentMatch[] = [];
  const unmatchedLineIds: string[] = [];
  for (const line of lines) {
    const match = await lookup(line, settings);
    if (match) matches.push(match);
    else unmatchedLineIds.push(line.lineId);
  }
  return { configured: true, matches, unmatchedLineIds };
}
