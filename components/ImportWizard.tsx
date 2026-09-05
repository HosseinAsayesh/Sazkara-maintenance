'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import {
  commitImportAction,
  parseImportAction,
  reviewImportAction,
  type CommitState,
  type ParseState,
  type ReviewState,
} from '@/app/actions/imports';
import { Link } from '@/i18n/navigation';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from './ui';

const FIELDS = [
  'uid',
  'storeName',
  'cityName',
  'address',
  'digitalAddress',
  'managerName',
  'phone',
] as const;

/**
 * §5 — three-step import: upload → map columns → review duplicates → commit.
 *
 * The uploaded workbook is parsed server-side and kept in storage between steps; only
 * headers, a sample and the duplicate summary travel to the browser, so a 3000-row Jti
 * sheet doesn't have to be serialised into the page.
 */
export function ImportWizard({ locale }: { locale: string }) {
  const t = useTranslations('imports');
  const tc = useTranslations('common');

  const [parseState, parseAction, parsing] = useActionState<ParseState, FormData>(
    parseImportAction,
    {},
  );
  const [reviewState, setReviewState] = useState<ReviewState>({});
  const [commitState, commitAction, committing] = useActionState<CommitState, FormData>(
    commitImportAction,
    {},
  );
  const [, startTransition] = useTransition();
  const [reviewing, setReviewing] = useState(false);

  const [sheetName, setSheetName] = useState('');
  const [mapping, setMapping] = useState<Record<string, number | ''>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [batchName, setBatchName] = useState('');
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState('');

  const parsed = parseState.parsed;
  const activeSheet = useMemo(
    () => parsed?.sheets.find((s) => s.name === sheetName) ?? parsed?.sheets[0],
    [parsed, sheetName],
  );

  // Seed the mapping from the server's suggestion the first time a file is parsed.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (parsed && seededFor !== parsed.fileRef) {
    setSeededFor(parsed.fileRef);
    setSheetName(parsed.sheets[0]?.name ?? '');
    const next: Record<string, number | ''> = {};
    for (const field of FIELDS) {
      const v = parsed.suggestedMapping?.[field];
      next[field] = v === undefined ? '' : v;
    }
    setMapping(next);
  }

  const runReview = async () => {
    if (!parsed || !activeSheet) return;
    setReviewing(true);
    const fd = new FormData();
    fd.set('fileRef', parsed.fileRef);
    fd.set('sheetName', activeSheet.name);
    fd.set('headerRow', '1');
    for (const field of FIELDS) {
      if (mapping[field] !== '' && mapping[field] !== undefined) {
        fd.set(`map_${field}`, String(mapping[field]));
      }
    }
    const result = await reviewImportAction({}, fd);
    setReviewState(result);
    // Duplicates start excluded: Jti re-sends codes that don't need work, and the safe
    // default is to leave them out until the manager decides otherwise (§6.4).
    if (result.review) {
      setExcluded(new Set(Object.keys(result.review.previouslyRepaired)));
    }
    setReviewing(false);
  };

  const review = reviewState.review;
  const duplicateUids = review ? Object.keys(review.previouslyRepaired) : [];

  if (commitState.ok) {
    return (
      <Card className="p-6 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 text-lg font-bold text-teal-700">
          {t('committed', { count: commitState.ok.created })}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {t('excluded')}: {commitState.ok.excluded}
        </p>
        <Link
          href="/manager/imports"
          className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          {tc('back')}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---------- step 1: upload ---------- */}
      <Card>
        <CardHeader title={t('uploadTitle')} description={t('uploadHelp')} />
        <form action={parseAction} className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label={t('batchName')} required>
            <Input
              name="name"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              placeholder={t('batchNamePlaceholder')}
            />
          </Field>
          <Field label={tc('upload')} required>
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls"
              required
              className="block w-full text-sm file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={parsing}>
              {parsing ? tc('loading') : tc('next')}
            </Button>
          </div>
        </form>
        {parseState.error ? (
          <div className="px-4 pb-4">
            <Alert tone="danger">
              {t.has(`errors.${parseState.error}`)
                ? t(`errors.${parseState.error}`)
                : tc('error')}
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* ---------- step 2: map columns ---------- */}
      {parsed && activeSheet ? (
        <Card>
          <CardHeader title={t('mappingTitle')} description={t('mappingHelp')} />
          <div className="space-y-4 p-4">
            {parsed.suggestedProfile ? (
              <Alert tone="info">
                {t('profileMatched', { name: parsed.suggestedProfile.name })}
              </Alert>
            ) : null}

            {parsed.sheets.length > 1 ? (
              <Field label={t('sheet')}>
                <Select value={sheetName} onChange={(e) => setSheetName(e.target.value)}>
                  {parsed.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.rowCount})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <TableWrap>
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <Th>{t('systemField')}</Th>
                    <Th>{t('detectedColumns')}</Th>
                    <Th>{t('sample')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map((field) => {
                    const selected = mapping[field];
                    const sampleValue =
                      selected !== '' && selected !== undefined
                        ? activeSheet.sample[0]?.[selected as number]
                        : '';
                    return (
                      <tr key={field}>
                        <Td className="whitespace-nowrap font-medium">
                          {t(`fields.${field}`)}
                          {field === 'uid' ? <span className="text-red-500"> *</span> : null}
                        </Td>
                        <Td>
                          <Select
                            value={selected === undefined ? '' : String(selected)}
                            onChange={(e) =>
                              setMapping((m) => ({
                                ...m,
                                [field]: e.target.value === '' ? '' : Number(e.target.value),
                              }))
                            }
                          >
                            <option value="">{t('ignore')}</option>
                            {activeSheet.headers.map((header, i) => (
                              <option key={i} value={i}>
                                {header}
                              </option>
                            ))}
                          </Select>
                        </Td>
                        <Td className="max-w-[14rem] truncate text-xs text-[var(--muted)]">
                          {sampleValue || '—'}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

            <Button type="button" onClick={runReview} disabled={reviewing || mapping.uid === ''}>
              {reviewing ? tc('loading') : tc('next')}
            </Button>

            {reviewState.error ? (
              <Alert tone="danger">
                {t.has(`errors.${reviewState.error}`)
                  ? t(`errors.${reviewState.error}`)
                  : tc('error')}
              </Alert>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ---------- step 3: review + commit ---------- */}
      {review ? (
        <Card>
          <CardHeader title={t('reviewTitle')} />
          <form
            className="space-y-4 p-4"
            action={(fd) => {
              fd.set('fileRef', review.fileRef);
              fd.set('sheetName', review.sheetName);
              fd.set('headerRow', String(review.headerRow));
              fd.set('name', batchName || 'Import');
              fd.set('locale', locale);
              fd.set('signature', parsed?.signature ?? '');
              for (const [field, index] of Object.entries(review.mapping)) {
                fd.set(`map_${field}`, String(index));
              }
              for (const uid of excluded) fd.append('excludeUid', uid);
              startTransition(() => commitAction(fd));
            }}
          >
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="info">{t('rowsFound', { count: review.rows.length })}</Badge>
              {review.skippedNoUid > 0 ? (
                <Badge tone="warning">
                  {t('invalidRows', { count: review.skippedNoUid })}
                </Badge>
              ) : null}
              {review.duplicatesInFile.length > 0 ? (
                <Badge tone="warning">
                  {t('duplicateInFile', { count: review.duplicatesInFile.length })}
                </Badge>
              ) : null}
              {duplicateUids.length > 0 ? (
                <Badge tone="danger">
                  {t('duplicatesFound', { count: duplicateUids.length })}
                </Badge>
              ) : null}
            </div>

            {/* §6.4 — never silently drop or silently include. */}
            {duplicateUids.length > 0 ? (
              <div className="space-y-2">
                <Alert tone="warning" title={t('duplicatesFound', { count: duplicateUids.length })}>
                  {t('duplicatesHelp')}
                </Alert>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setExcluded(new Set(duplicateUids))}
                  >
                    {t('excludeAllDuplicates')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setExcluded(new Set())}
                  >
                    {t('includeAllDuplicates')}
                  </Button>
                </div>

                <TableWrap>
                  <Table className="min-w-0">
                    <thead>
                      <tr>
                        <Th>{tc('uid')}</Th>
                        <Th>{t('duplicateHeader')}</Th>
                        <Th>{tc('actions')}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {duplicateUids.map((uid) => {
                        const info = review.previouslyRepaired[uid];
                        const isExcluded = excluded.has(uid);
                        return (
                          <tr key={uid}>
                            <Td className="dir-ltr font-medium">{uid}</Td>
                            <Td className="text-xs text-[var(--muted)]">
                              {new Date(info.lastRepairedAt).toLocaleDateString(
                                locale === 'fa' ? 'fa-IR' : 'en-GB',
                              )}
                              {info.cityName ? ` — ${info.cityName}` : ''} — {info.formCode}
                            </Td>
                            <Td>
                              <label className="inline-flex items-center gap-2 text-xs">
                                <input
                                  type="checkbox"
                                  checked={!isExcluded}
                                  onChange={(e) =>
                                    setExcluded((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.delete(uid);
                                      else next.add(uid);
                                      return next;
                                    })
                                  }
                                />
                                {isExcluded ? t('exclude') : t('include')}
                              </label>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="saveProfile"
                  checked={saveProfile}
                  onChange={(e) => setSaveProfile(e.target.checked)}
                />
                {t('saveProfile')}
              </label>
              {saveProfile ? (
                <Field label={t('profileName')}>
                  <Input
                    name="profileName"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>

            <Button type="submit" size="lg" disabled={committing}>
              {committing ? tc('submitting') : t('commit')}
            </Button>

            {commitState.error ? (
              <Alert tone="danger">
                {t.has(`errors.${commitState.error}`)
                  ? t(`errors.${commitState.error}`)
                  : tc('error')}
              </Alert>
            ) : null}
          </form>
        </Card>
      ) : null}
    </div>
  );
}
