'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Input } from './ui';

interface Suggestion {
  uid: string;
  storeName: string | null;
  cityName: string | null;
  kind: 'ORDER' | 'HISTORY';
}

/**
 * A uid box that lists matching uids as they are typed: open order rows first («در
 * سفارش»), then uids known from earlier work («سابقه»). The list narrows with every
 * character; tapping a row fills the box and calls `onPick`. Typing a uid that is not
 * listed still works — a stand found in the field is not always in an order.
 */
export function UidAutocomplete({
  value,
  onChange,
  onPick,
  placeholder,
  className,
  autoFocus,
  enterKeyHint,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick?: (uid: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  enterKeyHint?: 'go' | 'search';
}) {
  const t = useTranslations('uidLookup');
  const listId = useId();
  /** The last answer, tagged with the text it answers, so a stale list is never shown. */
  const [result, setResult] = useState<{ q: string; items: Suggestion[] }>({ q: '', items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const q = value.trim();
  const items = result.q === q ? result.items : [];
  const loading = q.length >= 2 && result.q !== q;

  // Debounced fetch; an aborted or superseded request never lands.
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/uids/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((data: { items: Suggestion[] }) => {
          setResult({ q, items: data.items ?? [] });
          setActive(-1);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // Close when tapping anywhere else.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const pick = (s: Suggestion) => {
    onChange(s.uid);
    setOpen(false);
    onPick?.(s.uid);
  };

  const showList = open && q.length >= 2;

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList || !items.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(-1, i - 1));
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        dir="ltr"
        className={className}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint={enterKeyHint}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-white shadow-lg"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-[var(--muted)]">
              {loading ? t('searching') : t('noMatch')}
            </li>
          ) : (
            items.map((s, i) => (
              <li key={s.uid} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className={
                    'flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-brand-50 ' +
                    (i === active ? 'bg-brand-50' : '')
                  }
                >
                  <span className="min-w-0">
                    <span className="dir-ltr block text-sm font-semibold text-brand-800">
                      {s.uid}
                    </span>
                    <span className="block truncate text-xs text-[var(--muted)]">
                      {[s.storeName, s.cityName].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span
                    className={
                      'shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ' +
                      (s.kind === 'ORDER'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600')
                    }
                  >
                    {s.kind === 'ORDER' ? t('inOrder') : t('history')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
