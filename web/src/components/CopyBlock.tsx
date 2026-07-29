import { useEffect, useState } from 'react';

/** Copyable command block (the landing install step). Clipboard API only — on
 * the rare denial the visitor selects the text, which `select-all` makes a
 * single click. */
export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex flex-col gap-2">
      <pre className="num select-all whitespace-pre-wrap break-all rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-[11px] leading-relaxed text-ink-200">
        {text}
      </pre>
      <button
        type="button"
        className="btn text-xs"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        {copied ? 'Copied ✓' : 'Copy command'}
      </button>
    </div>
  );
}
