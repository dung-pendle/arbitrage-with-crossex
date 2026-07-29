/**
 * Dynamic test-symbol selection for the live trade suite.
 *
 * Criteria (every selected symbol, including env overrides, must pass ALL):
 *   - state 'live', businessType 'FUTURE', quote USDT
 *   - exchange ∈ {GATE, BYBIT} — never HYPERLIQUID/KRAKEN (we place market legs)
 *   - min_notional ≤ notional/2 (half the budget clears the venue minimum)
 *   - lotSize × refPrice ≤ notional/3 (one lot is a small fraction of the budget)
 *
 * The suite needs TWO symbols with the SAME base on DIFFERENT venues (the pair
 * scenario trades them delta-neutrally). Preference order: ETH, SOL, XRP, DOGE.
 * Env overrides LIVE_TRADE_LONG_SYMBOL / LIVE_TRADE_SHORT_SYMBOL (both or neither)
 * are re-checked against the exact same criteria.
 */
import type { Symbol as RuleSymbol } from 'gate-api';
import type { Clients } from '../../src/core/clients';
import { parseSymbol, roundToStep } from '../../src/core/numbers';
import { resolveReferencePrice } from '../../src/core/orders';

export const PREFERRED_BASES = ['ETH', 'SOL', 'XRP', 'DOGE'];
export const ALLOWED_EXCHANGES = ['GATE', 'BYBIT'];

export interface SelectedSymbol {
  symbol: string;
  base: string;
  exchange: string;
  rule: RuleSymbol;
  refPrice: number;
  refSource: string;
}

export interface SymbolSelection {
  base: string;
  /** The BUY leg in the pair scenario; also the single-symbol scenarios' symbol A. */
  primary: SelectedSymbol;
  /** The SELL leg in the pair scenario; also symbol B in the mixed basket. */
  secondary: SelectedSymbol;
}

/** All criteria failures for one rule at one reference price (empty = eligible). */
export function criteriaFailures(rule: RuleSymbol, refPrice: number, notional: number): string[] {
  const fails: string[] = [];
  const p = parseSymbol(rule.symbol ?? '');
  if (rule.state !== 'live') fails.push(`state=${rule.state} (need live)`);
  if (rule.businessType !== 'FUTURE') fails.push(`businessType=${rule.businessType} (need FUTURE)`);
  if (p.quote !== 'USDT') fails.push(`quote=${p.quote} (need USDT)`);
  if (!ALLOWED_EXCHANGES.includes(p.exchange)) {
    fails.push(`exchange=${p.exchange} (allowed: ${ALLOWED_EXCHANGES.join('/')})`);
  }
  const minNotional = Number(rule.minNotional ?? 0);
  if (!(minNotional <= notional / 2)) {
    fails.push(`minNotional=${rule.minNotional} > notional/2 (${notional / 2})`);
  }
  const lotCost = Number(rule.lotSize) * refPrice;
  if (!(lotCost <= notional / 3)) {
    fails.push(`lotSize×ref=$${lotCost.toFixed(4)} > notional/3 ($${(notional / 3).toFixed(2)})`);
  }
  return fails;
}

async function refFor(clients: Clients, base: string): Promise<{ price: number; source: string }> {
  return resolveReferencePrice(clients, { pairs: [`${base}_USDT`] });
}

function toSelected(rule: RuleSymbol, ref: { price: number; source: string }): SelectedSymbol {
  const p = parseSymbol(rule.symbol ?? '');
  return { symbol: rule.symbol, base: p.base, exchange: p.exchange, rule, refPrice: ref.price, refSource: ref.source };
}

async function fromOverrides(
  clients: Clients,
  notional: number,
  longSym: string,
  shortSym: string,
): Promise<SymbolSelection> {
  const symbols = [longSym.toUpperCase(), shortSym.toUpperCase()];
  const { body: rules } = await clients.crossEx.listCrossexRuleSymbols({ symbols: symbols.join(',') });
  const byName = new Map((rules ?? []).map((r) => [r.symbol, r]));
  const picked: SelectedSymbol[] = [];
  for (const symbol of symbols) {
    const rule = byName.get(symbol);
    if (!rule) throw new Error(`symbol override ${symbol} not found on CrossEx`);
    const ref = await refFor(clients, parseSymbol(symbol).base);
    const fails = criteriaFailures(rule, ref.price, notional);
    if (fails.length) throw new Error(`symbol override ${symbol} fails selection criteria: ${fails.join('; ')}`);
    picked.push(toSelected(rule, ref));
  }
  const [primary, secondary] = picked;
  if (primary.base !== secondary.base) {
    throw new Error(`symbol overrides must share one base (got ${primary.base} vs ${secondary.base})`);
  }
  if (primary.exchange === secondary.exchange) {
    throw new Error(`symbol overrides must be on different venues (both ${primary.exchange})`);
  }
  return { base: primary.base, primary, secondary };
}

/** Pick the pair of test symbols (env overrides win but face the same checks). */
export async function selectPairSymbols(clients: Clients, notional: number): Promise<SymbolSelection> {
  const longOv = process.env.LIVE_TRADE_LONG_SYMBOL;
  const shortOv = process.env.LIVE_TRADE_SHORT_SYMBOL;
  if (longOv || shortOv) {
    if (!longOv || !shortOv) {
      throw new Error('set BOTH LIVE_TRADE_LONG_SYMBOL and LIVE_TRADE_SHORT_SYMBOL (or neither)');
    }
    return fromOverrides(clients, notional, longOv, shortOv);
  }

  const { body: rules } = await clients.crossEx.listCrossexRuleSymbols();
  for (const base of PREFERRED_BASES) {
    const onBase = (rules ?? []).filter((r) => {
      const p = parseSymbol(r.symbol ?? '');
      return p.base === base && ALLOWED_EXCHANGES.includes(p.exchange) && p.quote === 'USDT';
    });
    if (onBase.length < 2) continue;
    let ref: { price: number; source: string };
    try {
      ref = await refFor(clients, base);
    } catch {
      continue; // no reference price for this base — try the next one
    }
    const eligible: SelectedSymbol[] = [];
    for (const exchange of ALLOWED_EXCHANGES) {
      const rule = onBase.find(
        (r) => parseSymbol(r.symbol ?? '').exchange === exchange && criteriaFailures(r, ref.price, notional).length === 0,
      );
      if (rule) eligible.push(toSelected(rule, ref));
    }
    if (eligible.length >= 2) {
      return { base, primary: eligible[0], secondary: eligible[1] };
    }
  }
  throw new Error(
    `no ${PREFERRED_BASES.join('/')} USDT perp pair on ${ALLOWED_EXCHANGES.join('+')} fits a $${notional} budget`,
  );
}

/** Smallest lot-multiple qty satisfying minSize AND qty×price ≥ minNotional
 * (ceil to lot until both minimums hold). */
export function smallestValidQty(rule: RuleSymbol, price: number): string {
  const lot = rule.lotSize;
  const lotN = Number(lot);
  const minSize = Number(rule.minSize);
  const minNotional = Number(rule.minNotional);
  let q = Number(roundToStep(Math.max(minSize, minNotional / price), lot, 'down'));
  for (let i = 0; i < 10_000 && (q < minSize - 1e-12 || q * price < minNotional - 1e-9); i++) {
    q = Number(roundToStep(q + lotN, lot, 'nearest'));
  }
  return roundToStep(q, lot, 'nearest');
}
