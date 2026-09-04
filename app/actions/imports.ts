'use server';

import { revalidatePath } from 'next/cache';

import { requireActionManager } from '@/lib/auth';
import {
  buildReview,
  commitImport,
  extractRows,
  headerSignature,
  parseManualUids,
  parseWorkbook,
  type ColumnMapping,
  type ImportField,
  type ImportRow,
  IMPORT_FIELDS,
} from '@/lib/imports';
import { prisma } from '@/lib/prisma';
import { getStorage } from '@/lib/storage';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface ParseState {
  error?: string;
  parsed?: {
    fileRef: string;
    signature: string;
    sheets: Array<{ name: string; headers: string[]; sample: string[][]; rowCount: number }>;
    suggestedMapping?: ColumnMapping;
    suggestedProfile?: { id: string; name: string };
  };
}

/** Step 1 (§5): read the workbook and report its columns for mapping. */
export async function parseImportAction(
  _prev: ParseState,
  formData: FormData,
): Promise<ParseState> {
  try {
    await requireActionManager();

    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'parseFailed' };
    if (file.size > MAX_UPLOAD_BYTES) return { error: 'parseFailed' };

    const buffer = Buffer.from(await file.arrayBuffer());
    const headerRow = Number(formData.get('headerRow') ?? 1) || 1;

    const parsed = await parseWorkbook(buffer, headerRow);
    if (parsed.sheets.length === 0) return { error: 'noRows' };

    // Keep the original for audit; the review step re-reads it rather than shuttling
    // thousands of rows through the client.
    const fileRef = await getStorage().put(buffer, {
      prefix: 'imports',
      filename: file.name || 'order.xlsx',
    });

    // §5 — reuse a saved mapping when the header row matches a previous upload.
    const signature = headerSignature(parsed.sheets[0].headers);
    const profile = await prisma.columnMappingProfile.findFirst({
      where: { signature },
      orderBy: { createdAt: 'desc' },
    });

    return {
      parsed: {
        fileRef,
        signature,
        sheets: parsed.sheets,
        suggestedMapping: (profile?.mapping as ColumnMapping) ?? guessMapping(parsed.sheets[0].headers),
        suggestedProfile: profile ? { id: profile.id, name: profile.name } : undefined,
      },
    };
  } catch (err) {
    console.error('parseImportAction failed', err);
    return { error: 'parseFailed' };
  }
}

/**
 * Best-effort first guess so the manager usually only has to confirm. Purely a
 * convenience — nothing is imported until they approve the mapping.
 */
const HEADER_HINTS: Record<ImportField, string[]> = {
  uid: ['شناسه', 'uid', 'code', 'کد', 'id', 'شناسه استند'],
  storeName: ['store', 'نام فروشگاه', 'فروشگاه', 'store name', 'shop'],
  address: ['address', 'آدرس', 'نشانی'],
  digitalAddress: ['digital', 'map', 'نقشه', 'لینک', 'gps'],
  managerName: ['manager', 'مدیر', 'owner', 'مالک', 'نام مدیر'],
  phone: ['tel', 'phone', 'تلفن', 'موبایل', 'شماره'],
  cityName: ['city', 'شهر', 'استان'],
};

function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();

  for (const field of IMPORT_FIELDS) {
    const hints = HEADER_HINTS[field];
    const index = headers.findIndex((header, i) => {
      if (used.has(i)) return false;
      const h = header.trim().toLowerCase();
      return hints.some((hint) => h.includes(hint.toLowerCase()));
    });
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  return mapping;
}

export interface ReviewState {
  error?: string;
  review?: {
    fileRef: string;
    sheetName: string;
    headerRow: number;
    mapping: ColumnMapping;
    rows: ImportRow[];
    skippedNoUid: number;
    duplicatesInFile: string[];
    previouslyRepaired: Record<
      string,
      { uid: string; lastRepairedAt: string; cityName: string | null; formCode: string }
    >;
  };
}

function readMapping(formData: FormData): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const raw = formData.get(`map_${field}`);
    if (raw === null || raw === '') continue;
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0) mapping[field] = index;
  }
  return mapping;
}

/** Step 2 (§5, §6.4): apply the mapping and surface duplicates for a decision. */
export async function reviewImportAction(
  _prev: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  try {
    await requireActionManager();

    const fileRef = String(formData.get('fileRef') ?? '');
    const sheetName = String(formData.get('sheetName') ?? '');
    const headerRow = Number(formData.get('headerRow') ?? 1) || 1;
    const mapping = readMapping(formData);

    if (mapping.uid === undefined) return { error: 'uidRequired' };
    if (!fileRef) return { error: 'parseFailed' };

    const buffer = await getStorage().get(fileRef);
    const { rows, skippedNoUid } = await extractRows(buffer, {
      sheetName,
      headerRow,
      mapping,
    });
    if (rows.length === 0) return { error: 'noRows' };

    const review = await buildReview(rows, skippedNoUid);

    return {
      review: {
        fileRef,
        sheetName,
        headerRow,
        mapping,
        rows: review.rows,
        skippedNoUid: review.skippedNoUid,
        duplicatesInFile: review.duplicatesInFile,
        previouslyRepaired: Object.fromEntries(
          Object.entries(review.previouslyRepaired).map(([uid, info]) => [
            uid,
            {
              uid: info.uid,
              lastRepairedAt: info.lastRepairedAt.toISOString(),
              cityName: info.cityName,
              formCode: info.formCode,
            },
          ]),
        ),
      },
    };
  } catch (err) {
    console.error('reviewImportAction failed', err);
    return { error: 'parseFailed' };
  }
}

export interface CommitState {
  error?: string;
  ok?: { batchId: string; total: number; created: number; excluded: number };
}

/** Step 3 (§5): write the batch. */
export async function commitImportAction(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  try {
    const manager = await requireActionManager();

    const fileRef = String(formData.get('fileRef') ?? '');
    const sheetName = String(formData.get('sheetName') ?? '');
    const headerRow = Number(formData.get('headerRow') ?? 1) || 1;
    const name = String(formData.get('name') ?? '').trim() || 'Import';
    const locale = String(formData.get('locale') || 'fa');
    const mapping = readMapping(formData);

    if (!fileRef || mapping.uid === undefined) return { error: 'uidRequired' };

    const buffer = await getStorage().get(fileRef);
    const { rows } = await extractRows(buffer, { sheetName, headerRow, mapping });
    if (rows.length === 0) return { error: 'noRows' };

    // Save the mapping for next time, if asked.
    let mappingProfileId: string | undefined;
    const profileName = String(formData.get('profileName') ?? '').trim();
    if (formData.get('saveProfile') === 'on' && profileName) {
      const signature = String(formData.get('signature') ?? '');
      const profile = await prisma.columnMappingProfile.upsert({
        where: { name: profileName },
        create: { name: profileName, signature, mapping: mapping as object },
        update: { signature, mapping: mapping as object },
      });
      mappingProfileId = profile.id;
    }

    const excludedUids = formData
      .getAll('excludeUid')
      .map((v) => String(v))
      .filter(Boolean);

    const result = await commitImport(rows, {
      name,
      source: 'JTI_EXCEL',
      importedById: manager.id,
      fileRef,
      mapping,
      mappingProfileId,
      excludedUids,
    });

    revalidatePath(`/${locale}/manager/imports`);
    revalidatePath(`/${locale}/manager`, 'layout');

    return {
      ok: {
        batchId: result.batch.id,
        total: result.total,
        created: result.created,
        excluded: result.excluded,
      },
    };
  } catch (err) {
    console.error('commitImportAction failed', err);
    return { error: 'parseFailed' };
  }
}

/** §5 — the stray uids Jti sends as plain text rather than in the sheet. */
export async function addManualUidsAction(
  _prev: CommitState,
  formData: FormData,
): Promise<CommitState> {
  try {
    const manager = await requireActionManager();

    const text = String(formData.get('uids') ?? '');
    const locale = String(formData.get('locale') || 'fa');
    const cityName = String(formData.get('cityName') ?? '').trim() || undefined;
    const uids = parseManualUids(text);
    if (uids.length === 0) return { error: 'noRows' };

    const rows: ImportRow[] = uids.map((uid, i) => ({
      rowNumber: i + 1,
      uid,
      cityName,
    }));

    const result = await commitImport(rows, {
      name: String(formData.get('name') ?? '').trim() || 'Manual UIDs',
      source: 'MANUAL',
      importedById: manager.id,
      // §6.2 — a manager adding a uid by hand still routes it through confirmation, so
      // the pending-uids screen stays the single place stray codes are admitted.
      confirmStands: false,
    });

    revalidatePath(`/${locale}/manager/imports`);
    revalidatePath(`/${locale}/manager/pending-uids`);
    revalidatePath(`/${locale}/manager`, 'layout');

    return {
      ok: {
        batchId: result.batch.id,
        total: result.total,
        created: result.created,
        excluded: result.excluded,
      },
    };
  } catch (err) {
    console.error('addManualUidsAction failed', err);
    return { error: 'parseFailed' };
  }
}
