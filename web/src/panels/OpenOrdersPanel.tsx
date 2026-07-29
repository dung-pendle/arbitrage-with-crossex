import { useCancelOrder, useOpenOrders } from '../api/queries';
import type { OpenOrder } from '../api/types';
import { Chip, type ChipTone } from '../components/Chip';
import { DataTable, type Column } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { QueryError } from '../components/QueryError';
import { TableSkeleton } from '../components/Skeleton';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { SideChip, SymbolCell } from '../components/VenueChip';
import { fmtAge, sig, toDate } from '../lib/fmt';

/** DEFENSIVE state → tone map. Gate's order-state enum is undocumented: match
 * known-ish forms case-insensitively; ANY unknown string renders verbatim in a
 * neutral chip — never crash, never hide the raw value. */
function stateTone(state: string): ChipTone {
  const s = state.trim().toLowerCase();
  if (s === 'open' || s === 'new' || s === 'live') return 'blue';
  if (s.includes('partial')) return 'amber';
  if (s === 'filled') return 'green';
  if (s === 'cancelled' || s === 'canceled') return 'neutral';
  if (s === 'rejected') return 'red';
  return 'neutral';
}

/** POC → "post-only"; otherwise "LMT GTC" / "MKT" style. */
function typeLabel(o: OpenOrder): string {
  const type = (o.type ?? '').toUpperCase();
  const tif = (o.timeInForce ?? '').toUpperCase();
  if (tif === 'POC') return 'post-only';
  const base = type === 'LIMIT' ? 'LMT' : type === 'MARKET' ? 'MKT' : type || '—';
  return tif && type !== 'MARKET' ? `${base} ${tif}` : base;
}

function FillProgress({ o }: { o: OpenOrder }) {
  const total = Number(o.qty) || 0;
  const done = Number(o.executedQty) || 0;
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="num">
        {sig(done)}<span className="text-ink-500">/{sig(total)}</span>
      </span>
      <div className="h-0.5 w-20 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Open orders tab: live resting orders with immediate cancel. */
export function OpenOrdersPanel() {
  const { data, isPending, isError, error } = useOpenOrders();
  const cancel = useCancelOrder();
  const toast = useToast();

  if (isPending) return <TableSkeleton rows={3} cols={8} />;
  if (isError && !data) {
    return <QueryError title="Couldn't load open orders" error={error} />;
  }

  const orders = data ?? [];
  const cancelingId = cancel.isPending ? cancel.variables : undefined;

  const columns: Column<OpenOrder>[] = [
    { key: 'symbol', header: 'Symbol', render: (o) => <SymbolCell symbol={o.symbol} /> },
    { key: 'side', header: 'Side', render: (o) => <SideChip side={o.side} /> },
    {
      key: 'type',
      header: 'Type',
      render: (o) => (
        <span className="inline-flex items-center gap-1.5">
          <Chip sm className="num">{typeLabel(o)}</Chip>
          {o.reduceOnly && <span className="text-[9px] uppercase text-ink-500" title="reduce-only">RO</span>}
        </span>
      ),
    },
    { key: 'price', header: 'Price', align: 'right', render: (o) => <span className="num">{sig(o.price)}</span> },
    { key: 'filled', header: 'Filled', align: 'right', render: (o) => <FillProgress o={o} /> },
    {
      key: 'avg',
      header: 'Avg fill',
      align: 'right',
      render: (o) =>
        Number(o.executedAvgPrice) > 0 ? (
          <span className="num">{sig(o.executedAvgPrice)}</span>
        ) : (
          <span className="text-ink-500">—</span>
        ),
    },
    {
      key: 'state',
      header: 'State',
      render: (o) => (
        <Chip sm tone={stateTone(o.state)}>
          {o.state}
        </Chip>
      ),
    },
    {
      key: 'age',
      header: 'Age',
      align: 'right',
      render: (o) => {
        const d = toDate(o.createTime);
        return <span className="num text-ink-300">{d ? fmtAge(Date.now() - d.getTime()) : '—'}</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (o) => (
        <button
          type="button"
          className="btn-ghost-xs text-rose-400 hover:border-rose-500/50 hover:text-rose-300"
          disabled={cancelingId === o.orderId}
          onClick={() =>
            cancel.mutate(o.orderId, {
              onError: (err) => toast.push('error', `Cancel ${o.orderId} failed: ${(err as Error).message}`),
            })
          }
        >
          {cancelingId === o.orderId ? <Spinner className="h-3 w-3" /> : 'Cancel'}
        </button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={orders}
      rowKey={(o) => o.orderId}
      emptyState={
        <EmptyState icon="⧖" title="No open orders" hint="Resting limit orders appear here the moment they're placed." />
      }
    />
  );
}
