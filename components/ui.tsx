import clsx from 'clsx';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Small presentational primitives shared by both the technician (mobile-first) and
 * manager (desktop-first) surfaces. Deliberately plain — Tailwind logical properties
 * (ms/me/ps/pe/start/end) do the RTL/LTR work, so nothing here branches on direction.
 */

export function Card({
  className,
  children,
  ...rest
}: ComponentProps<'div'>) {
  return (
    <div
      className={clsx(
        'rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-brand-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  secondary:
    'bg-white text-brand-900 border border-[var(--border)] hover:bg-brand-50 disabled:text-brand-400',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200',
  success: 'bg-teal-700 text-white hover:bg-teal-900 disabled:bg-teal-200',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ComponentProps<'button'> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-3 text-base',
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-brand-600">
        {label}
        {required ? <span className="text-red-500">*</span> : null}
      </span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm ' +
  'placeholder:text-brand-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-100 ' +
  'disabled:bg-brand-50 disabled:text-ink-400';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={clsx(CONTROL, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={clsx(CONTROL, 'min-h-24', className)} {...rest} />;
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={clsx(CONTROL, 'pe-8', className)} {...rest} />;
}

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-brand-100 text-brand-600',
  success: 'bg-teal-100 text-teal-900',
  danger: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-900',
  info: 'bg-teal-50 text-teal-700',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const accent: Record<Tone, string> = {
    neutral: 'text-brand-900',
    success: 'text-teal-700',
    danger: 'text-red-700',
    warning: 'text-amber-700',
    info: 'text-teal-700',
  };
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className={clsx('mt-1 text-2xl font-bold tabular-nums', accent[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-[var(--muted)]">{hint}</div> : null}
    </Card>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
      {children}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones: Record<Tone, string> = {
    neutral: 'border-brand-200 bg-brand-50 text-brand-700',
    success: 'border-teal-200 bg-teal-50 text-teal-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-teal-200 bg-teal-50 text-teal-900',
  };
  return (
    <div className={clsx('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className={clsx(title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}

/** Horizontally scrollable table wrapper — wide reports must never scroll the page. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="w-full overflow-x-auto">{children}</div>;
}

export function Table({ className, ...rest }: ComponentProps<'table'>) {
  return <table className={clsx('w-full min-w-[36rem] text-sm', className)} {...rest} />;
}

export function Th({ className, ...rest }: ComponentProps<'th'>) {
  return (
    <th
      className={clsx(
        'whitespace-nowrap border-b border-[var(--border)] bg-brand-50 px-3 py-2 text-start text-xs font-semibold text-ink-500',
        className,
      )}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<'td'>) {
  return (
    <td
      className={clsx('border-b border-[var(--border)] px-3 py-2 align-middle', className)}
      {...rest}
    />
  );
}
