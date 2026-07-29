/** First-load skeletons. Background refetches keep previous data (see
 * queries.ts placeholderData), so these only ever show on first mount. */

export function Skeleton({ className = 'h-4 w-24' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink-700/50 ${className}`} />;
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-700 px-3 py-2.5">
        <Skeleton className="h-3 w-full max-w-lg" />
      </div>
      <div className="divide-y divide-ink-800">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-3 py-2.5">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton key={j} className={`h-3.5 ${j === 0 ? 'w-40' : 'w-full max-w-[90px]'}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TilesSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="card h-24 animate-pulse bg-ink-800/60" />
      ))}
    </div>
  );
}
