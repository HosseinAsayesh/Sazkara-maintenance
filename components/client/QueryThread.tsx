'use client';

import clsx from 'clsx';
import { useActionState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  replyQueryAction,
  resolveQueryAction,
  type QueryActionState,
} from '@/app/actions/client-queries';

import { Alert, Badge, Button, Textarea } from '../ui';

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: Date;
  side: 'CLIENT' | 'TEAM';
}

/**
 * One question and its answers, read and written by both sides.
 *
 * Messages are attributed to a SIDE, never a person. Naming the manager would be
 * harmless; naming the technician whose work is being questioned would turn a query
 * about a stand into a complaint about an individual, and the panel withholds technician
 * identity everywhere else. Keeping it to two sides makes that consistent rather than an
 * exception someone has to remember.
 */
export function QueryThread({
  locale,
  queryId,
  status,
  messages,
  viewerSide,
  compact,
}: {
  locale: string;
  queryId: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  messages: ThreadMessage[];
  /** Which side the signed-in viewer is on; decides alignment and who may resolve. */
  viewerSide: 'CLIENT' | 'TEAM';
  /** Hides the reply box until the thread is opened, for long lists. */
  compact?: boolean;
}) {
  const t = useTranslations('client');
  const tc = useTranslations('common');
  const format = useFormatter();

  const [replyState, reply, replying] = useActionState<QueryActionState, FormData>(
    replyQueryAction,
    {},
  );
  const [resolveState, resolve, resolving] = useActionState<QueryActionState, FormData>(
    resolveQueryAction,
    {},
  );

  const resolved = status === 'RESOLVED';
  // A manager may not close a question nobody has answered — that is how a question gets
  // made to disappear instead of addressed. The server enforces it; this hides the
  // button so the rule is visible rather than discovered by being refused.
  const mayResolve = !resolved && (viewerSide === 'CLIENT' || status === 'ANSWERED');

  return (
    <div className="rounded-lg border border-[var(--border)] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
        <Badge tone={resolved ? 'neutral' : status === 'ANSWERED' ? 'info' : 'warning'}>
          {resolved
            ? t('queryResolved')
            : status === 'ANSWERED'
              ? t('queryAnswered')
              : t('queryOpen')}
        </Badge>
        {mayResolve ? (
          <form action={resolve}>
            <input type="hidden" name="queryId" value={queryId} />
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" size="sm" variant="secondary" disabled={resolving}>
              {t('queryResolveAction')}
            </Button>
          </form>
        ) : null}
      </div>

      <ul className="space-y-2 p-3">
        {messages.map((m) => {
          const mine = m.side === viewerSide;
          return (
            <li
              key={m.id}
              className={clsx('flex', mine ? 'justify-end' : 'justify-start')}
            >
              <div
                className={clsx(
                  'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                  m.side === 'CLIENT'
                    ? 'bg-amber-50 text-ink-900'
                    : 'bg-teal-50 text-ink-900',
                )}
              >
                <div className="mb-0.5 text-[11px] font-medium text-[var(--muted)]">
                  {m.side === 'CLIENT' ? t('sideClient') : t('sideTeam')} ·{' '}
                  {format.dateTime(m.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                </div>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      {resolved ? (
        <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
          {t('queryClosedNote')}
        </p>
      ) : compact ? null : (
        <form action={reply} className="space-y-2 border-t border-[var(--border)] p-3">
          <input type="hidden" name="queryId" value={queryId} />
          <input type="hidden" name="locale" value={locale} />
          <Textarea name="body" rows={2} placeholder={t('queryReplyPlaceholder')} />
          {replyState.error ? (
            <Alert tone="danger">{t(`queryError.${replyState.error}`)}</Alert>
          ) : null}
          {resolveState.error ? (
            <Alert tone="danger">{t(`queryError.${resolveState.error}`)}</Alert>
          ) : null}
          <Button type="submit" size="sm" disabled={replying}>
            {replying ? tc('saving') : t('queryReplyAction')}
          </Button>
        </form>
      )}
    </div>
  );
}
