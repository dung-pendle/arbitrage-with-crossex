/** A stacked list of amber warning/note strings. Renders nothing when empty. */
export function Notes({
  items,
  className,
  textClass = 'text-xs',
}: {
  items: string[];
  /** Container margin/spacing (e.g. "mb-2"). */
  className?: string;
  /** Per-line size class; '' inherits the parent size. */
  textClass?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`}>
      {items.map((n) => (
        <div key={n} className={`${textClass} leading-relaxed text-amber-400/90`.trim()}>
          {n}
        </div>
      ))}
    </div>
  );
}
