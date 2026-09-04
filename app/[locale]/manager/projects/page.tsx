import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ProjectsManager, type ProjectRow } from '@/components/ProjectsManager';
import { requireManager } from '@/lib/auth';
import { formatDateForLocale } from '@/lib/dates';
import { listProjects } from '@/lib/projects';
import { getStorage } from '@/lib/storage';

export default async function ProjectsPage({
  params,
}: PageProps<'/[locale]/manager/projects'>) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireManager(locale);

  const t = await getTranslations({ locale, namespace: 'projects' });
  const projects = await listProjects();

  const rows: ProjectRow[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    code: project.code,
    isActive: project.isActive,
    // Formatted on the server so the client component never re-derives a calendar.
    startDate: formatDateForLocale(project.startDate, locale),
    endDate: project.endDate ? formatDateForLocale(project.endDate, locale) : null,
    formCount: project._count.repairForms,
    batchCount: project._count.batches,
    phases: project.phases.map((p) => ({
      id: p.id,
      name: p.name,
      sortOrder: p.sortOrder,
    })),
    batches: project.batches.map((b) => ({
      id: b.id,
      name: b.name,
      source: b.source,
      phaseName: b.phase?.name ?? null,
      lineCount: b._count.lines,
      importedAt: formatDateForLocale(b.importedAt, locale),
      // Archives keep their uploaded original; older batches may predate that.
      fileUrl: b.fileRef ? getStorage().url(b.fileRef) : null,
    })),
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-brand-900">{t('title')}</h1>
      <ProjectsManager locale={locale} projects={rows} />
    </div>
  );
}
