import 'server-only';

/**
 * What a model call cost, and to whom. Every call a learner or an author causes is written down
 * with its tokens and its price, so an operator can see where the money goes and the server can stop
 * before it goes too far.
 *
 * Prices are per million tokens in US dollars, as published for the Claude API (2026-10). Cache
 * writes are the 5-minute TTL (1.25× input), which is what the writers ask for. A call the
 * server-side fallback answered with another model is priced as the model that answered; a model
 * not listed here is priced as the dearest one listed, so an unknown never reads as cheap.
 */
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
const prices: Record<string, Price> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const dearest = Object.values(prices).reduce((a, b) => (b.output > a.output ? b : a));

/** What the work was for: a learner's AI practice, a gathered set filled for one learner, or an author's editor. */
export type { UsageFeature } from '@/shared/ai-usage';

/** One call as the API reported it. `input` is the uncached input; cached reads and writes are counted apart. */
export type ModelCall = { step: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number };
/** Where a model reports each call it made. The model does not know who it is for; the caller does. */
export type UsageSink = (call: ModelCall) => void;

/** A call's price in millionths of a dollar, rounded up so many small calls never add to nothing. */
export function costMicros(call: Omit<ModelCall, 'step'>): number {
  const price = prices[call.model] ?? dearest;
  // Per million tokens and in millionths of a dollar: the two millions cancel.
  return Math.ceil(call.input * price.input + call.output * price.output + call.cacheRead * price.cacheRead + call.cacheWrite * price.cacheWrite);
}
export const priced = (model: string) => model in prices;

/** Dollars from millionths, for people. */
export const dollars = (micros: number) => micros / 1_000_000;
