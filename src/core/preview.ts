/**
 * Preview service: resolveActions (no side effects) enriched with fill-price and
 * fee estimates. Estimates are advisory and never block — violations do that.
 */
import { resolveActions, type ActionInput, type PreviewResult } from './actions';
import type { Clients } from './clients';
import { fetchVenueBook as realFetchVenueBook, touchOf, type fetchVenueBook } from './estimate/books';
import { estimateFill } from './estimate/fill';
import { estimateFees, resolveFeeRates, type VenueFeeRow } from './estimate/fees';
import { parseSymbol } from './numbers';

interface PreviewDeps {
  clients: Clients;
  /** The account's /crossex/fee rows (server caches them). */
  feeRows: VenueFeeRow[];
  /** Injectable for tests. */
  fetchBook?: typeof fetchVenueBook;
}

export async function previewActions(deps: PreviewDeps, actions: ActionInput[]): Promise<PreviewResult[]> {
  const resolved = await resolveActions(deps.clients, actions, { mode: 'preview' });
  return Promise.all(
    resolved.map(async (r): Promise<PreviewResult> => {
      const preview: PreviewResult = { ...r, warnings: [...r.warnings] };

      // Tentative avg fill price for anything that crosses the book NOW:
      // market opens and marketable-limit (IOC) closes.
      const crossesNow = r.type === 'MARKET' || (r.type === 'LIMIT' && r.tif === 'IOC');
      if (crossesNow && r.qty && r.violations.length === 0) {
        const refPrice = r.refPrice?.value ?? r.closing?.mark;
        const est = await estimateFill(
          { clients: deps.clients, fetchBook: deps.fetchBook },
          { symbol: r.symbol, side: r.side, qty: r.qty, refPrice },
        ).catch(() => null);
        if (est) preview.fillEstimate = est;
        else preview.warnings.push('no fill estimate available (no book, no reference price)');
      }

      // A POC leg doesn't cross — surface the venue's touch instead, so the
      // ticket can default/refresh the maker price to the top of the book.
      if (r.type === 'LIMIT' && r.tif === 'POC') {
        const { exchange, base, quote } = parseSymbol(r.symbol);
        const book = await (deps.fetchBook ?? realFetchVenueBook)(exchange, base, quote).catch(() => null);
        const touch = touchOf(book);
        if (touch) preview.restEstimate = touch;
        else preview.warnings.push('no venue book available — maker price cannot be refreshed from the touch');
      }

      const rates = resolveFeeRates(deps.feeRows, r.symbol);
      if (!rates) {
        preview.warnings.push(`no fee rates found for ${r.symbol} — fee estimate unavailable`);
      } else if (r.qty) {
        const price =
          preview.fillEstimate?.avgPrice ??
          (r.price ? Number(r.price) : (r.refPrice?.value ?? r.closing?.mark ?? 0));
        if (price > 0) {
          preview.fees = estimateFees(rates, { type: r.type, tif: r.tif, qty: r.qty, price });
        }
      }
      return preview;
    }),
  );
}
