import { useEffect, useState } from 'react';

/** Copyable command block (the landing install step, and the LLM audit prompt).
 * Clipboard API only — on the rare denial the visitor selects the text, which
 * `select-all` makes a single click. */
export function CopyBlock({
  text,
  label = 'Copy command',
  maxHeightClass,
}: {
  text: string;
  label?: string;
  /** Cap the preview and let it scroll — for text long enough to dominate the
   * rail (the audit prompt). Copy takes the whole thing either way. */
  maxHeightClass?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex flex-col gap-2">
      <pre
        className={`num select-all whitespace-pre-wrap break-all rounded-md border border-ink-700 bg-ink-900 px-2.5 py-2 text-[11px] leading-relaxed text-ink-200 ${
          maxHeightClass ? `${maxHeightClass} overflow-y-auto` : ''
        }`}
      >
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
        {copied ? 'Copied ✓' : label}
      </button>
    </div>
  );
}
