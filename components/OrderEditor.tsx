'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import {
  addOrderLineAction,
  assignOrderProjectAction,
  deleteOrderAction,
  deleteOrderLineAction,
  updateOrderLineAction,
  type ActionState,
} from '@/app/actions/orders';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
} from './ui';

export interface OrderLineRow {
  id: string;
  uid: string;
  storeName: string | null;
  address: string | null;
  digitalAddress: string | null;
  managerName: string | null;
  phone: string | null;
  cityName: string | null;
  status: string;
  isDuplicate: boolean;
  duplicateNote: string | null;
  /** A row with fieldwork against it is history and is protected from deletion. */
  hasForms: boolean;
}

export interface OrderProjectOption {
  id: string;
  name: string;
  phases: Array<{ id: string; name: string }>;
}

/**
 * Edit an imported Jti order in place.
 *
 * Jti's spreadsheets routinely arrive with a wrong phone number, a merged store name or
 * a row that shouldn't be there, and re-importing the whole file to fix one cell is not
 * a workflow. Rows can be corrected, added and removed here, and the order itself
 * deleted or moved to another project/phase.
 *
 * The guard rail: anything a technician has already reported against is protected. Order
 * rows are the request; repair forms are the record.
 */
export function OrderEditor({
  locale,
  batchId,
  batchName,
  lines,
  projects,
  currentProjectId,
  currentPhaseId,
}: {
  locale: string;
  batchId: string;
  batchName: string;
  lines: OrderLineRow[];
  projects: OrderProjectOption[];
  currentProjectId: string | null;
  currentPhaseId: string | null;
}) {
  const t = useTranslations('imports');
  const tc = useTranslations('common');
  const tErr = useTranslations('errors');

  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [updateState, updateAction] = useActionState<ActionState, FormData>(
    updateOrderLineAction,
    {},
  );
  const [deleteLineState, deleteLineAction] = useActionState<ActionState, FormData>(
    deleteOrderLineAction,
    {},
  );
  const [addState, addAction] = useActionState<ActionState, FormData>(
    addOrderLineAction,
    {},
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteOrderAction,
    {},
  );
  const [assignState, assignAction] = useActionState<ActionState, FormData>(
    assignOrderProjectAction,
    {},
  );

  const [projectId, setProjectId] = useState(currentProjectId ?? '');
  const phases = projects.find((p) => p.id === projectId)?.phases ?? [];

  const err = (state: ActionState) =>
    state.error ? (
      <Alert tone="danger">
        {tErr.has(state.error) ? tErr(state.error) : tc('error')}
      </Alert>
    ) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={batchName}
          description={t('editLines')}
          action={
            <form
              action={deleteAction}
              onSubmit={(e) => {
                if (!confirm(t('deleteOrderConfirm'))) e.preventDefault();
              }}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="batchId" value={batchId} />
              <Button type="submit" variant="danger" size="sm">
                {t('deleteOrder')}
              </Button>
            </form>
          }
        />

        <div className="space-y-3 p-4">
          {err(deleteState)}
          {err(assignState)}

          {/* Re-filing an order under a different campaign changes which export it
              lands in, so it is an explicit control rather than an import-time guess. */}
          <form action={assignAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="batchId" value={batchId} />
            <label className="min-w-[10rem]">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {tc('project')}
              </span>
              <Select
                name="projectId"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="min-w-[9rem]">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {tc('phase')}
              </span>
              <Select name="phaseId" defaultValue={currentPhaseId ?? ''} key={projectId}>
                <option value="">—</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              {tc('save')}
            </Button>
          </form>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t('lines')}
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAdding((a) => !a)}
            >
              + {t('addLine')}
            </Button>
          }
        />

        <div className="space-y-3 p-3">
          {err(updateState)}
          {err(deleteLineState)}
          {err(addState)}

          {adding ? (
            <form
              action={addAction}
              className="grid gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 sm:grid-cols-3"
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="batchId" value={batchId} />
              <Input name="uid" placeholder={tc('uid')} required className="dir-ltr" />
              <Input name="storeName" placeholder={tc('store')} />
              <Input name="cityName" placeholder={tc('city')} />
              <Input name="managerName" placeholder={tc('manager')} />
              <Input name="phone" placeholder={tc('phone')} className="dir-ltr" />
              <Input name="address" placeholder={tc('address')} />
              <div className="sm:col-span-3 flex gap-2">
                <Button type="submit" size="sm">
                  {tc('add')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAdding(false)}
                >
                  {tc('cancel')}
                </Button>
              </div>
            </form>
          ) : null}

          {lines.length === 0 ? (
            <EmptyState>{tc('noResults')}</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>{tc('uid')}</Th>
                    <Th>{tc('store')}</Th>
                    <Th>{tc('city')}</Th>
                    <Th>{tc('manager')}</Th>
                    <Th>{tc('phone')}</Th>
                    <Th>{tc('status')}</Th>
                    <Th>{tc('actions')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) =>
                    editing === line.id ? (
                      <tr key={line.id} className="bg-brand-50/60">
                        <Td colSpan={7}>
                          <form
                            action={updateAction}
                            onSubmit={() => setEditing(null)}
                            className="grid gap-2 py-2 sm:grid-cols-3"
                          >
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="lineId" value={line.id} />
                            <Input
                              name="uid"
                              defaultValue={line.uid}
                              className="dir-ltr"
                              required
                            />
                            <Input
                              name="storeName"
                              defaultValue={line.storeName ?? ''}
                              placeholder={tc('store')}
                            />
                            <Input
                              name="cityName"
                              defaultValue={line.cityName ?? ''}
                              placeholder={tc('city')}
                            />
                            <Input
                              name="managerName"
                              defaultValue={line.managerName ?? ''}
                              placeholder={tc('manager')}
                            />
                            <Input
                              name="phone"
                              defaultValue={line.phone ?? ''}
                              className="dir-ltr"
                              placeholder={tc('phone')}
                            />
                            <Input
                              name="digitalAddress"
                              defaultValue={line.digitalAddress ?? ''}
                              className="dir-ltr"
                              placeholder={tc('digitalAddress')}
                            />
                            <div className="sm:col-span-3">
                              <Input
                                name="address"
                                defaultValue={line.address ?? ''}
                                placeholder={tc('address')}
                              />
                            </div>
                            <div className="sm:col-span-3 flex gap-2">
                              <Button type="submit" size="sm">
                                {t('saveLine')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditing(null)}
                              >
                                {tc('cancel')}
                              </Button>
                            </div>
                          </form>
                        </Td>
                      </tr>
                    ) : (
                      <tr key={line.id}>
                        <Td className="dir-ltr font-medium">
                          {line.uid}
                          {line.isDuplicate ? (
                            <Badge tone="warning" className="ms-1">
                              ↻
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="max-w-[12rem] truncate">{line.storeName ?? '—'}</Td>
                        <Td>{line.cityName ?? '—'}</Td>
                        <Td>{line.managerName ?? '—'}</Td>
                        <Td className="dir-ltr">{line.phone ?? '—'}</Td>
                        <Td>
                          <Badge
                            tone={
                              line.status === 'DONE'
                                ? 'success'
                                : line.status === 'EXCLUDED'
                                  ? 'neutral'
                                  : 'warning'
                            }
                          >
                            {t(`status.${line.status}`)}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(line.id)}
                            >
                              {tc('edit')}
                            </Button>
                            {/* Protected once fieldwork exists — the report is the record. */}
                            {!line.hasForms ? (
                              <form action={deleteLineAction}>
                                <input type="hidden" name="locale" value={locale} />
                                <input type="hidden" name="lineId" value={line.id} />
                                <Button type="submit" variant="ghost" size="sm">
                                  {tc('delete')}
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    ),
                  )}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </div>
      </Card>
    </div>
  );
}
