# User guide

A short guide to the two screens you'll use most: the **Opportunities** scan and the
**order ticket**. Everything here is descriptive, not advice — see [DISCLAIMER.md](./DISCLAIMER.md).

---

## The Opportunities tab

The scan finds Boros market pairs (same collateral, same maturity, same underlying) and prices
the **whole 4-leg trade at your size** — the headline is the net fixed APR **on the capital the
trade consumes**, after every cost the app can model. The assumptions you pick decide what that
number means, so set them to match how you would actually trade:

- **Size** — under *Market at size*, every rate is produced by walking real order books at this
  notional per leg. Set it to what you would genuinely deploy: a bigger size eats deeper into
  the books (worse executable rates), and a group whose books can't carry the size **silently
  drops off the list** — if raising the size makes rows vanish, depth is why. A tiny
  placeholder size makes everything look better than you can have.

- **Boros entry: "Market at size" vs "At mark rate"** — how the two Boros legs get their fixed
  rates. *Market at size* walks the live Boros books as a taker: the spread you could lock
  **right now**, paying the bid–ask gap and your own impact. *At mark rate* assumes you rest
  limit orders patiently and get filled at the mark APR: cheaper on paper, but a hope, not a
  price — the market has to come to you. Decide with *Market at size*; use *At mark rate* only
  to see what patience could add.

- **Perp entry: "Both market" vs "Maker + hedge"** — how the two hedge perps get opened.
  *Both market* crosses both legs immediately: certain and instant, but you pay two taker fees
  and both spreads. *Maker + hedge* rests one leg post-only (maker fee, no crossing cost) and
  hedges each fill on the other venue as it happens: cheaper, at the cost of fill time and a
  possible timeout. The scan's cost ledger follows whichever you pick.

- **Exit: "Close" vs "Roll over"** — *Close* folds in the estimated perp exit fees plus exit
  slippage priced by crossing back out of today's books (the opposite side of the same
  snapshot) — the conservative, all-in number. *Roll over* charges no exit costs, assuming you
  keep the perps and roll into the next maturity.

- **Fee tier** — before you connect Gate keys you can pick a simulated VIP tier to see how fees
  move the result; once connected, the scan always prices from your account's real schedule
  (and the selector disappears).

Reading a row: the **net APR on capital** is directly comparable to "Fixed APR on capital" on
your open positions — same formula, modelled capital (Boros initial margin + perp margin at
venue max leverage). Expand a row for the full cost waterfall; every cost the app cannot know
shows as a named reason, never a silent zero.

---

## The order ticket — opening a pair well

Open the pair ticket from an Opportunities row (**Execute it**): it lands prefilled with the
venues, your scan size and the scan's execution mode, so the ticket prices exactly what the
scan promised. Nothing is submitted until you hold Execute.

The pair ticket opens both perp legs **delta-neutral** — one long, one short, same size. The
usual best path:

1. **Pick "Maker + hedge"** execution. The ticket automatically rests the maker leg on the
   venue where resting is cheaper and shows the saving; the other leg hedges each maker fill
   with a taker order on the next engine tick, so unhedged exposure is bounded by roughly one
   tick plus one order-resolution window.
2. **Leave the price on "track book"** — each time the engine places or re-places the maker it
   derives the price one bid–ask gap *behind* the same-side touch, so it can never cross. A
   live resting order is deliberately **not** chased as the book moves — use the deal view's
   **Re-peg** to follow a moving market. Type a price only when you want to pin it (the engine
   then holds *your* price and ignores the book).
3. **Set a maker timeout** — if the maker leg hasn't fully filled in time, the remainder is
   converted with market IOC clips instead of hanging half-open forever. Pick a timeout that
   matches how urgent the entry is.
4. **Leverage is per leg at each venue's max** — the same assumption the scan's capital number
   used, applied automatically before the deal is created.
5. **Hold Execute.** One deal is created; the live deal view opens and tracks it.

After submission the deal engine owns the orders: it hedges every fill, re-derives the maker
price whenever it re-places the order, and raises an alert if anything cannot be hedged. Use the deal view's own **Stop** /
**Convert now** / **Re-peg** controls rather than cancelling orders by hand — a hand-cancelled
engine order reads as an instruction to abandon the remaining acquisition.

Closing works the same way in reverse: closes are reduce-only, and the slippage band you set is
enforced on the wire (an IOC limit at reference ± band), not just displayed.
