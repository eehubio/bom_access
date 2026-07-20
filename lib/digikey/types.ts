export interface DigiKeyEnrichmentRequestLine {
  lineId: string;
  manufacturerPartNumber?: string;
  searchQuery?: string;
  footprint?: string | null;
}

export interface DigiKeyEnrichmentMatch {
  lineId: string;
  queriedManufacturerPartNumber: string;
  matchedManufacturerPartNumber: string;
  manufacturer: string | null;
  package: string | null;
  description: string | null;
  digiKeyProductNumber: string | null;
  productUrl: string | null;
  confidence: number;
  matchType: "exact_mpn" | "candidate";
  source: "digikey_product_search_v4" | "mouser_search_v1";
}

export interface DigiKeyEnrichmentResponse {
  configured: boolean;
  matches: DigiKeyEnrichmentMatch[];
  unmatchedLineIds: string[];
  message?: string;
}
