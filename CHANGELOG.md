# Changelog

Only substantial releases are listed here — each one bumps `version.json` (which is what the
in-app update check compares against).

## 1.0.0 — 2026-07-30

- Update notifications — the terminal now tells you when a new version is out, with per-OS
  update instructions.
- User guide (docs/USER_GUIDE.md), linked from the header: how to set the Opportunities
  assumptions and how to open a pair well.
- Per-leg hedge top-ups: an under-hedged position names exactly how much more to open on each
  venue, and a one-click pair CTA completes a symmetric gap.
- Sizing gate: a strategy's headline APR / capital / PnL-by-maturity stay hidden until the
  4-leg book is genuinely built (Boros legs matched, perp legs matched, layers sized together).
- Boros order books now ride the shared 30s cache cadence — an order of magnitude fewer
  backend requests from an open dashboard.
- USDC-margined twin contracts (Binance/OKX/Bybit) removed from the venue pickers — separate
  books with independently-settled funding, unhedgeable against the Boros markets this
  terminal tracks.
