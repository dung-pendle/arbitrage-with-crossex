/**
 * Anchored close-position popover for a position row: slippage band, full vs
 * partial qty (validated against the live position), and a live preview of the
 * reduce-only IOC marketable-limit close. "Close now" is inline hold-to-confirm.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ActionInput, CrossexPosition } from '../api/types';
import { SegmentedToggle } from '../components/SegmentedToggle';
import { SignedNumber } from '../components/SignedNumber';
import { SideChip, SymbolCell } from '../components/VenueChip';
import { fmtUsd, sig } from '../lib/fmt';
import { ExecuteControl } from './ExecuteControl';
import { feeText, PreviewFallback, ViolationList } from './previewBits';
import { usePreviewDebounced } from './usePreview';

const CLOSE_INFO =
  'The close is sent as a reduce-only IOC limit at mark ± slippage — it can never increase the position and never rests on the book.';

interface Props {
  position: CrossexPosition;
  /** Button rect to anchor near (null → fallback placement, e.g. in tests). */
  anchor: DOMRect | null;
  onDismiss: () => void;
}

export function ClosePopover({ position, anchor, onDismiss }: Props) {
  const [slipStr, setSlipStr] = useState('0.5');
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [qtyStr, setQtyStr] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const posQty = Math.abs(Number(position.positionQty));
  const slip = Number(slipStr);
  const slipInvalid = !Number.isFinite(slip) || slip <= 0 || slip > 10;
  const qtyNum = Number(qtyStr);
  const partialMissing = mode === 'partial' && qtyStr.trim() === '';
  const partialInvalid =
    mode === 'partial' && qtyStr.trim() !== '' && (!Number.isFinite(qtyNum) || qtyNum <= 0 || qtyNum > posQty);

  const action = useMemo<ActionInput | null>(() => {
    if (slipInvalid || partialMissing || partialInvalid) return null;
    return {
      kind: 'close-position',
      symbol: position.symbol,
      slippagePct: slip,
      ...(mode === 'partial' ? { qty: qtyStr } : {}),
    };
  }, [slipInvalid, partialMissing, partialInvalid, position.symbol, slip, mode, qtyStr]);

  const preview = usePreviewDebounced(`close-${position.symbol}`, action ? [action] : null, {
    debounceMs: 300,
    refetchInterval: 3_000,
  });
  const p = preview.previews?.[0];
  const estimating = preview.estimating;

  // Partial closes realize a proportional share of the position's uPnL.
  const upnlToRealize = p?.closing
    ? Number(p.closing.upnl) *
      (Number(p.closing.positionQty) !== 0 ? Math.min(1, Number(p.qty) / Math.abs(Number(p.closing.positionQty))) : 1)
    : null;

  const style = anchor
    ? { top: anchor.bottom + 6, left: Math.max(8, anchor.right - 300) }
    : { top: 96, right: 16 };

  return (
    <div className="fixed inset-0 z-50" role="presentation" onClick={onDismiss}>
      <div
        role="dialog"
        aria-label={`Close ${position.symbol}`}
        className="fixed w-[300px] rounded-xl border border-ink-600 bg-ink-900 p-3 shadow-2xl"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-ink-100">Close position</span>
          <button type="button" aria-label="dismiss" className="btn-ghost-xs px-1.5" onClick={onDismiss}>
            ✕
          </button>
        </div>
        <div className="mb-2">
          <SymbolCell symbol={position.symbol} />
        </div>

        <div className="flex flex-col gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <label htmlFor={`close-slip-${position.symbol}`} className="w-24 text-ink-400">
              Slippage %
            </label>
            <input
              id={`close-slip-${position.symbol}`}
              className={`input num h-8 flex-1 px-2 py-1 ${slipInvalid ? 'border-rose-500' : ''}`}
              inputMode="decimal"
              value={slipStr}
              onChange={(e) => setSlipStr(e.target.value)}
            />
          </div>
          {slipInvalid && <span className="text-rose-400">slippage must be in (0, 10]</span>}

          <div className="flex items-center gap-2">
            <span className="w-24 text-ink-400">Amount</span>
            <SegmentedToggle<'full' | 'partial'>
              ariaLabel="Close amount"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'full', label: <span className="text-xs">full</span> },
                { value: 'partial', label: <span className="text-xs">partial</span> },
              ]}
            />
          </div>
          {mode === 'partial' && (
            <div className="flex items-center gap-2">
              <label htmlFor={`close-qty-${position.symbol}`} className="w-24 text-ink-400">
                Close qty
              </label>
              <input
                id={`close-qty-${position.symbol}`}
                className={`input num h-8 flex-1 px-2 py-1 ${partialInvalid ? 'border-rose-500' : ''}`}
                inputMode="decimal"
                placeholder={`≤ ${sig(posQty)}`}
                value={qtyStr}
                onChange={(e) => setQtyStr(e.target.value)}
              />
            </div>
          )}
          {partialInvalid && <span className="text-rose-400">close qty exceeds position ({sig(posQty)})</span>}

          {action && (
            <div className="flex flex-col gap-1 rounded-lg border border-ink-800 bg-ink-950/60 px-2.5 py-2">
              {p ? (
                <>
                  {estimating && <span className="text-amber-400">estimating…</span>}
                  <span className="flex items-center gap-1.5 text-ink-300">
                    <SideChip side={p.side} />
                    <span className="num text-ink-100">{p.qty ? sig(p.qty) : '—'}</span>
                  </span>
                  <span className="text-ink-400">
                    marketable limit px <span className="num text-ink-100">{p.price ? sig(p.price) : '—'}</span>
                  </span>
                  <span className="text-ink-400">
                    uPnL to realize{' '}
                    {upnlToRealize !== null ? <SignedNumber value={upnlToRealize} format={(n) => fmtUsd(n)} /> : '—'}
                  </span>
                  <span className="text-ink-400">est fee {feeText(p.fees)}</span>
                  <span className="cursor-help text-ink-500" title={CLOSE_INFO}>
                    reduce-only IOC marketable limit ⓘ
                  </span>
                  <ViolationList violations={p.violations} warnings={p.warnings} />
                </>
              ) : (
                <PreviewFallback isError={preview.isError} error={preview.error} />
              )}
            </div>
          )}

          <ExecuteControl
            scope={`close-${position.symbol}`}
            actions={action ? [action] : null}
            tone="red"
            label="Close now ▸"
            buttonClassName="mt-1 w-full"
            previewOpts={{ debounceMs: 300, refetchInterval: 3_000 }}
            onExecuted={onDismiss}
          />
        </div>
      </div>
    </div>
  );
}
