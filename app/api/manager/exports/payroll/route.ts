import { getCurrentUser } from '@/lib/auth';
import { localDayRange } from '@/lib/dates';
import { rangeLabel, safeFilename } from '@/lib/exports/jti';
import { buildPayrollWorkbook } from '@/lib/exports/payroll';
import { getPayroll, getPayrollLines, readPayrollParams } from '@/lib/payroll';

/** Technician payroll for the filtered period — manager only, like every money view. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (user.role !== 'MANAGER') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const url = new URL(request.url);
  const params = readPayrollParams(Object.fromEntries(url.searchParams));
  const range = localDayRange(params.from, params.to);
  const filters = { ...params, from: range.from, to: range.to };

  const [payroll, lines] = await Promise.all([getPayroll(filters), getPayrollLines(filters)]);
  const label = rangeLabel(params.from ?? null, params.to ?? null);
  const workbook = await buildPayrollWorkbook(payroll, lines, {
    label,
    includeReRepairs: params.includeReRepairs,
  });

  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(
        safeFilename(`Payroll ${label}`),
      )}.xlsx"`,
    },
  });
}
