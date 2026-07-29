import { parseSymbol } from '../lib/fmt';
import { Chip } from './Chip';

/** USDT-quoted perp venues get the cyan house tone; USD/USDC venues stay neutral. */
const USDT_PERP_VENUES = new Set(['BINANCE', 'BYBIT', 'GATE', 'OKX']);

/** Quote currency note for non-USDT venues (Gate CrossEx conventions). */
export const VENUE_QUOTE_NOTE: Record<string, string> = {
  KRAKEN: 'quotes USD',
  HYPERLIQUID: 'quotes USDC',
  DERIBIT: 'quotes USDC',
};

export function VenueChip({ exchange, crossex }: { exchange: string; crossex?: boolean }) {
  // The CrossEx provenance marker overrides the quote-currency tint: colour +
  // a text suffix (never colour alone) mark a leg held via the connected
  // Gate CrossEx account.
  if (crossex) {
    return (
      <Chip sm tone="violet" className="font-mono" title="via CrossEx (connected Gate account)">
        {exchange}
        <span className="ml-1 text-[9px] font-semibold text-violet-300">·CX</span>
      </Chip>
    );
  }
  return (
    <Chip sm tone={USDT_PERP_VENUES.has(exchange) ? 'cyan' : 'neutral'} className="font-mono">
      {exchange}
    </Chip>
  );
}

/** Venue chip + base coin (+ dim non-USDT quote) for a full CrossEx symbol. */
export function SymbolCell({ symbol }: { symbol: string }) {
  const { exchange, base, quote } = parseSymbol(symbol);
  return (
    <span className="inline-flex items-center gap-2">
      <VenueChip exchange={exchange} />
      <span className="font-medium text-ink-100">{base || symbol}</span>
      {quote && quote !== 'USDT' && <span className="text-[10px] text-ink-400">{quote}</span>}
    </span>
  );
}

/** LONG / SHORT (or BUY / SELL) side chip. */
export function SideChip({ side }: { side: string }) {
  const s = side.toUpperCase();
  const positive = s === 'LONG' || s === 'BUY';
  return (
    <Chip sm tone={positive ? 'green' : 'red'}>
      {s}
    </Chip>
  );
}
