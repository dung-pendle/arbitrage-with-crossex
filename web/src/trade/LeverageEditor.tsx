/** Inline leverage editor for a position row: validated against the row's
 * maxLeverage, PUT /api/leverage/:symbol on save, positions busted after. */
import { useState } from 'react';
import { useSetLeverage } from '../api/queries';
import type { CrossexPosition } from '../api/types';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { isLevOutOfRange } from '../lib/leverage';

export function LeverageEditor({ position, onDone }: { position: CrossexPosition; onDone: () => void }) {
  const [levStr, setLevStr] = useState(position.leverage);
  const setLev = useSetLeverage();
  const toast = useToast();

  const max = Number(position.maxLeverage) || 0;
  const n = Number(levStr);
  const invalid = isLevOutOfRange(n, max);

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        aria-label={`leverage for ${position.symbol}`}
        className={`input num h-7 w-16 px-2 py-0 text-xs ${invalid ? 'border-rose-500' : ''}`}
        inputMode="decimal"
        value={levStr}
        onChange={(e) => setLevStr(e.target.value)}
      />
      <span className="whitespace-nowrap text-[10px] text-ink-500">max {max || '?'}x</span>
      <button
        type="button"
        className="btn-ghost-xs"
        disabled={invalid || setLev.isPending}
        onClick={() =>
          setLev.mutate(
            { symbol: position.symbol, leverage: n },
            {
              onSuccess: () => {
                toast.push('success', `${position.symbol} leverage set to ${n}x`);
                onDone();
              },
              onError: (err) => toast.push('error', `Set leverage failed: ${(err as Error).message}`),
            },
          )
        }
      >
        {setLev.isPending ? <Spinner className="h-3 w-3" /> : 'Save'}
      </button>
      <button type="button" className="btn-ghost-xs" onClick={onDone}>
        Cancel
      </button>
    </span>
  );
}
