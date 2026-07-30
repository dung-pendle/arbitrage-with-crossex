# Changelog

Only substantial releases are listed here — each one bumps `version.json` (which is what the
in-app update check compares against).

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
