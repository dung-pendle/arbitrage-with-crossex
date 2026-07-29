# Open review findings (known issues)

An independent multi-agent review of this codebase (2026-07-29) — each finding adversarially
verified by tracing its failure scenario end-to-end through the code — surfaced 27 defects.
The 8 high-severity ones (1 critical, 7 major) were fixed before publication, each with a
regression test pinning its failure scenario. The 19 minor findings below remain open and are
tracked here for follow-up.

None of these is a money-loss path: they are edge-case hardening gaps, misleading operator
messages, over-strict validations, and test-coverage holes. File pointers are given per item;
line numbers are omitted deliberately (they drift).

## Engine & server

- **OPENING's hedge-first gating is weaker than CONVERTING's** (`src/engine/decide.ts`): during
  the backoff after a failed hedge attempt, a resting maker keeps filling (and can be re-placed)
  in OPENING, while CONVERTING in the identical state pauses with "hedge owed first". Bounded by
  the hedge wall (~3 backoff windows before HALT), but strictly weaker than the rule it mirrors.
- **Persistent read errors on a PENDING order never alert** (`src/engine/loop.ts`): the
  read-failure streak/alert covers OPEN orders only. A PENDING order whose venue reads keep
  erroring (revoked key, 5xx storm) freezes its pair silently, with no operator signal — even
  though the order may be live and filling.
- **Hand-cancel refusal can be bypassed** (`src/server/routes/orders.ts`): the guard matches only
  `venue_order_id`, but the venue's cancel endpoint also accepts the client text id — and during
  the create-unknown window the ledger's venue id is still NULL. Either path lands a CANCELLED
  the engine reads as an explicit user STOP, permanently relinquishing the acquisition.
- **Leg-A max-market-size check ignores `maxClip`** (`src/engine/create.ts`): the cap compares
  the FULL deal qty, but leg-A convert clips are split to at most `maxClip` — a deliberately
  clipped deal that could never send an over-cap order is rejected at creation. Fail-safe
  direction, but over-strict.
- **Banded clips price off book mid, not the venue reference** (`src/engine/decide.ts`): the
  comment claims the slippage band stays inside the venue's price-limit band, but `refPrice()` is
  (bid+ask)/2 of the public book. When mid dislocates from the venue's mark by more than the
  band, every clip draws a hard price-limit reject and the close stops at the reject budget —
  exactly during the volatile conditions the band exists for. Honest stop + alert, no silent loss.
- **Leverage upper bound fails open on an empty risk-limits reply** (`src/server/routes/deals.ts`):
  a successful-but-tierless response yields max 0, which skips the bound — and the 0 is cached
  for 10 minutes. An over-max leverage then reaches preflight, which under-reserves margin if the
  venue clamps instead of rejecting.
- **A sub-tick explicit re-peg BUY snaps to the string `"0"`** (`src/server/routes/deals.ts`):
  the raw input is validated `> 0`, then the directional snap floors it to `"0"`, which is truthy
  and gets pinned as the fixed intent price — burning the reject budget with a wrong recorded
  cause. The snapped output should be re-validated.
- **The finish reason always blames "below B's lot"** (`src/engine/decide.ts`): an unhedged
  terminal residual is attributed to the lot even when it is whole lots blocked by
  minSize/minNotional — misleading in the post-mortem report.
- **Boot-time permission tightening targets `dirname(envPath)`** (`src/server/index.ts`): in a
  source checkout the `.env`'s parent IS the repo root, so every dev boot chmods the checkout
  0700 (POSIX) or strips its ACL inheritance (Windows), silently. Installed layouts (dedicated
  config dir) are unaffected.
- **The Windows ACL lockout probe tests the wrong thing** (`src/server/secretFile.ts`):
  `fs.accessSync` on Windows checks only the read-only attribute, not the DACL — real lockouts
  pass undetected, while a read-only backup file in the config dir makes the probe throw and
  trigger a RECURSIVE `icacls /reset`, reverting the directory's protection on every boot.

## Installers

- **The bash scripts kill by command-line match alone** (`install.sh`, `uninstall.sh`):
  `pgrep -f <path>` matches any process merely holding the server path as an argument — an
  editor or `tail -f` gets SIGTERM/SIGKILLed. The Windows scripts constrain the match to the
  executables that can actually be the service; the bash scripts should do the same.
- **`Protect-Directory`'s graceful fallback is unreachable** (`install.ps1`): under PS 5.1 with
  `$ErrorActionPreference='Stop'`, the `2>&1` on icacls turns stderr into a terminating error
  before the exit-code check that was meant to degrade gracefully.
- **`Install-Node` deletes the in-use runtime before the service is stopped** (`install.ps1`):
  on an update, the old `node/` folder is removed while the previous server may still be running
  from it — violating the stop-before-delete ordering the script itself documents. Windows file
  locking makes this fail loudly rather than dangerously, but the ordering should match the docs.
- **The keepalive repetition may never tick** (`install.ps1`): the every-minute repetition is
  grafted onto an `-AtLogOn` trigger with no `StartBoundary`; when the task is registered after
  logon and started by hand, the repetition window never opens, leaving only the in-task
  supervisor loop as keepalive.

## Web & test coverage

- **The deal-view re-peg snap is nearest and side-unaware** (`web/src/trade/DealModal.tsx`):
  `snapToTick` can round a re-peg price onto the touch; the engine then pins that price
  (`pricePolicy 'fixed'`) into a post-only reject loop. Should use the directional
  `formatRestPrice` like the tickets do.
- **The server-side resting-price wiring is unpinned** (`tests/unit/format.test.ts` et al.):
  the directional-snap helper is tested, but reverting its three call sites (actions, engine
  create, venue gate) back to the nearest snap still passes the full suite — no test drives the
  wiring end-to-end.
- **The slippage band has no close-pair test** (`tests/unit/engine-loop.test.ts`): the banded
  clip is pinned for single-leg closes only; the close-PAIR path is untested, and one older test
  comment still describes the pre-fix (unpriced clip) semantics.
- **The hand-placed-cancel test proves nothing** (`tests/server/orders.test.ts`): "still cancels
  a hand-placed order while a deal is running" runs with no deal present, so it cannot detect a
  guard that wrongly blocks hand-placed orders during a live deal.
- **The Windows ACL branch has zero coverage** (`tests/unit/secret-file.test.ts`): the tests
  exercise only the POSIX chmod path; the icacls branch — the actual substance of the Windows
  hardening — is untested on every platform.
