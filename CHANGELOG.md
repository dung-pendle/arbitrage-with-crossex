# Changelog

Only substantial releases are listed here — each one bumps `version.json` (which is what the
in-app update check compares against).

## 1.2.0 — 2026-08-04

Cost modelling, order handling, and dashboard legibility.

- **The perp entry cost is itemised.** A new "Perp entry cost" assumption joins the exit one
  (now labelled Include / Omit (rolling over)), the cost breaks down per execution so a book
  built across several deals can drop the ones a position never paid, and entry slippage
  follows the deal journal even when a book was rebuilt along the way.
- **Single orders behave like single orders.** A lone limit order is placed as a plain order
  rather than a deal to supervise, its "order placed" receipt sticks, cancelling shows as
  pending instead of the order silently vanishing, and a deal frozen on a venue status the
  decoder cannot read can be unwedged. A pasted amount that isn't a number now says why.
- **Token-margined markets show notionals in token terms.** For Boros markets not margined in
  USDT, every leg's notional in the Opportunities and Positions boxes carries the token amount
  in brackets — Boros legs in their collateral token, perp position legs as their base-coin
  size. USDT-margined markets are unchanged.
- **The opportunity details link out.** Each Boros leg opens its market on Boros with the
  side prefilled.
- **"Enable CrossEx" is its own onboarding step**, before the API key and the funds.
- **Flat folder tabs.** The tab bar was machined down — colour is a signal, not decoration.
- **Install and dev hardening.** `install.sh` pins npm's prefix so a user `~/.npmrc` can't
  hijack the yarn install, and a dev stack can now run beside the installed app.

## 1.1.0 — 2026-07-30

Security pass, acting on an external audit (its findings, and what remains open, are in
`docs/REVIEW-FINDINGS.md`).

- **The local API requires a token.** Binding to loopback never stopped another local
  process from trading; every `/api` route except the installer's health probe now needs a
  per-install token stored 0600 beside your keys. Your browser gets it from the page, so the
  bookmarked http://localhost:6688 is unchanged. Scripting the API needs the `x-arb-token`
  header — see the README.
- **Hand-cancelling can no longer abandon a live deal.** The refusal guard now covers the
  client-text id the venue also accepts, and the window where an order is live on the venue
  before our ledger knows its id. Either path previously read as a deliberate STOP and gave up
  the rest of the entry permanently.
- **Install exactly what you audited.** `BOROS_REF` pins any commit, tag or branch on both
  platforms; the installers record the commit they laid down, and Settings → About shows it.
- **Windows key-file permissions no longer undo themselves** on every boot, and running from
  a source checkout no longer narrows the whole checkout to owner-only.
- **The macOS install/uninstall scripts** no longer SIGKILL an editor that happens to have
  the server path in its arguments — and no longer miss a server started with relative paths.

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
