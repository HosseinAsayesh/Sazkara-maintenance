'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import {
  assignLeadAction,
  setTechnicianRoleAction,
  type ActionState,
} from '@/app/actions/manager';

import { Badge, Button, Select } from './ui';

export interface LeadOption {
  id: string;
  name: string;
  technicianCode: string | null;
}

/**
 * Promote/demote a crew lead, and assign a technician to one.
 *
 * Both live on the technicians page because that is where the manager already thinks
 * about people. A lead's own row shows the promotion toggle and a crew count; a
 * technician's row shows which lead they report to.
 */
export function CrewControls({
  locale,
  userId,
  role,
  leadId,
  crewSize,
  leads,
}: {
  locale: string;
  userId: string;
  role: 'TECHNICIAN' | 'LEAD_TECHNICIAN';
  leadId: string | null;
  crewSize: number;
  leads: LeadOption[];
}) {
  const t = useTranslations('technicians');
  const [, roleAction, changingRole] = useActionState<ActionState, FormData>(
    setTechnicianRoleAction,
    {},
  );
  const [, assignAction] = useActionState<ActionState, FormData>(assignLeadAction, {});

  const isLead = role === 'LEAD_TECHNICIAN';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isLead ? (
        <Badge tone="info">
          {t('roleLead')} · {t('crewSize')} {crewSize}
        </Badge>
      ) : (
        // Which lead this technician reports to. Submitting on change keeps it to one
        // interaction — this is a list the manager edits in bulk.
        <form action={assignAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="userId" value={userId} />
          <Select
            name="leadId"
            defaultValue={leadId ?? ''}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-8 py-0 text-xs"
            aria-label={t('lead')}
          >
            <option value="">{t('noLead')}</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.technicianCode ? `${lead.technicianCode} — ` : ''}
                {lead.name}
              </option>
            ))}
          </Select>
        </form>
      )}

      <form action={roleAction}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="makeLead" value={isLead ? 'false' : 'true'} />
        <Button type="submit" variant="ghost" size="sm" disabled={changingRole}>
          {isLead ? t('removeLead') : t('makeLead')}
        </Button>
      </form>
    </div>
  );
}
