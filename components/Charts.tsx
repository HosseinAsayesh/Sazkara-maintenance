'use client';

import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Recharts wrappers for the §10 analytics.
 *
 * Charts are laid out LTR even inside the RTL page: reversing a bar chart's axis to
 * match text direction makes it harder to read, not easier, and the labels stay Persian
 * either way. Category labels are rendered on the Y axis so long Persian reason strings
 * don't get truncated the way rotated X-axis labels would.
 */

const PALETTE = ['#1f4f8a', '#4b7fbd', '#7aa5d2', '#f59e0b', '#ef4444', '#10b981'];

const AXIS = { fontSize: 11, fill: '#64748b' } as const;

export function ReasonBarChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  return (
    <div dir="ltr" style={{ width: '100%', height: Math.max(180, data.length * 46) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
          <XAxis type="number" allowDecimals={false} tick={AXIS} />
          <YAxis type="category" dataKey="label" width={190} tick={AXIS} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SuccessPieChart({
  repaired,
  notRepaired,
  labels,
}: {
  repaired: number;
  notRepaired: number;
  labels: { repaired: string; notRepaired: string };
}) {
  const data = [
    { name: labels.repaired, value: repaired },
    { name: labels.notRepaired, value: notRepaired },
  ];

  if (repaired + notRepaired === 0) return null;

  return (
    <div dir="ltr" style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={90} label>
            <Cell fill="#10b981" />
            <Cell fill="#ef4444" />
          </Pie>
          <Legend />
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** §10 — "53% of stands needed a transformer replaced". */
export function PartRateChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  const top = data.filter((d) => d.value > 0).slice(0, 18);
  if (top.length === 0) return null;

  return (
    <div dir="ltr" style={{ width: '100%', height: Math.max(200, top.length * 28) }}>
      <ResponsiveContainer>
        <BarChart data={top} layout="vertical" margin={{ left: 8, right: 40, top: 8, bottom: 8 }}>
          <XAxis type="number" domain={[0, 100]} unit="%" tick={AXIS} />
          <YAxis type="category" dataKey="label" width={150} tick={AXIS} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v) => `${v ?? 0}%`} />
          <Bar dataKey="value" fill="#1f4f8a" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CityBarChart({
  data,
  labels,
}: {
  data: Array<{ label: string; repaired: number; notRepaired: number }>;
  labels: { repaired: string; notRepaired: string };
}) {
  if (data.length === 0) return null;

  return (
    <div dir="ltr" style={{ width: '100%', height: Math.max(220, data.length * 40) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
          <XAxis type="number" allowDecimals={false} tick={AXIS} />
          <YAxis type="category" dataKey="label" width={110} tick={AXIS} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} />
          <Legend />
          <Bar dataKey="repaired" name={labels.repaired} stackId="a" fill="#10b981" />
          <Bar dataKey="notRepaired" name={labels.notRepaired} stackId="a" fill="#ef4444" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
