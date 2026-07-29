import type { ActionInput, PreviewResult } from '../api/types';

/**
 * Turn the LATEST preview into the execute-ready action array — THE contract in
 * front of /api/execute (notional-sized preview inputs are a 400 at execute).
 * Per preview `p`:
 *  - close-position → passed through untouched (the server re-derives the close
 *    from the live position; qty/slippagePct stay as entered).
 *  - otherwise → stamp the resolver's `p.qty` and strip preview-only `notional`.
 *  - open-limit → stamp the resolved (tick-snapped) `p.price` so executed ==
 *    displayed.
 */
export function finalizeActions(previews: PreviewResult[]): ActionInput[] {
  return previews.map((p) => {
    if (p.input.kind === 'close-position') return { ...p.input };
    const action = { ...p.input, qty: p.qty };
    delete action.notional;
    if (action.kind === 'open-limit' && p.price) action.price = p.price;
    return action;
  });
}
