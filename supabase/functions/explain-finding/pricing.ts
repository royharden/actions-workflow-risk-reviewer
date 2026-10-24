// Dated price entries (PLAN D16). NOTHING HERE IS VERIFIED: every entry has `verifiedOn: null` and null prices, so the
// handler answers 503 `not_configured` and no call can be charged until a human copies the provider's current price page
// into an entry and sets `verifiedOn` (ISO date of that check). Prices are USD per million tokens.

export interface PriceEntry {
  readonly model: string;
  readonly inputPerMTok: number | null;
  readonly outputPerMTok: number | null;
  /** ISO date (YYYY-MM-DD) a human checked these numbers against the provider's price page; null = unverified. */
  readonly verifiedOn: string | null;
  readonly note: string;
}

export interface VerifiedPrice {
  readonly model: string;
  readonly inputPerMTok: number;
  readonly outputPerMTok: number;
  readonly verifiedOn: string;
}

export const PRICES: readonly PriceEntry[] = [
  {
    model: 'claude-haiku-5-5',
    inputPerMTok: null,
    outputPerMTok: null,
    verifiedOn: null,
    note: 'Candidate model id only (PLAN D16). Verify the id against the provider model list and fill prices from the price page.',
  },
];

function positiveFinite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function realIsoDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The verified entry for `model`, or null (unknown model, unverified entry or unusable prices → 503, no call). */
export function lookupVerifiedPrice(prices: readonly PriceEntry[], model: string): VerifiedPrice | null {
  const entry = prices.find((p) => p.model === model);
  if (!entry || !realIsoDate(entry.verifiedOn)) return null;
  if (!positiveFinite(entry.inputPerMTok) || !positiveFinite(entry.outputPerMTok)) return null;
  return { model, inputPerMTok: entry.inputPerMTok, outputPerMTok: entry.outputPerMTok, verifiedOn: entry.verifiedOn };
}

/** USD for the given token counts, rounded up to the ledger's 6 decimal places. */
export function costUsd(price: VerifiedPrice, inputTokens: number, outputTokens: number): number {
  const raw = (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000;
  return Math.ceil(raw * 1_000_000) / 1_000_000;
}
