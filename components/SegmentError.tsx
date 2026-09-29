'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Alert, Button } from './ui';

/**
 * Fallback for a failed page or action inside a signed-in area. Rendered inside that
 * area's layout, so the header — and the license banner that usually explains a refused
 * save — stays on screen.
 */
export default function SegmentError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations('errors');
  const tc = useTranslations('common');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-3">
      <Alert tone="danger" title={tc('error')}>
        {t('segment')}
      </Alert>
      <Button variant="secondary" onClick={() => retry()}>
        {tc('retry')}
      </Button>
    </div>
  );
}
