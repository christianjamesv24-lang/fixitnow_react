import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { cn, initials, STATUS_STYLES, titleCase } from '../lib/utils';
import { publicAssetUrl } from '../lib/api';

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={cn('animate-spin text-brand-700', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4Z"
      />
    </svg>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-slate-500">
      <Spinner className="h-8 w-8" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function AvatarFallback({ name, size, className }) {
  const sizes = {
    xs: 'h-7 w-7 text-[10px]',
    sm: 'h-9 w-9 text-xs',
    md: 'h-11 w-11 text-sm',
    lg: 'h-16 w-16 text-lg',
    xl: 'h-24 w-24 text-2xl',
  };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-bold text-white ring-2 ring-white',
        sizes[size],
        className
      )}
      aria-hidden="true"
    >
      {initials(name) || '?'}
    </span>
  );
}

function AvatarImage({ name, src, size, className }) {
  const [failed, setFailed] = useState(false);
  const sizes = {
    xs: 'h-7 w-7',
    sm: 'h-9 w-9',
    md: 'h-11 w-11',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24',
  };
  if (failed) return <AvatarFallback name={name} size={size} className={className} />;
  return (
    <img
      src={publicAssetUrl(src)}
      alt={name}
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-full object-cover ring-2 ring-white', sizes[size], className)}
    />
  );
}

export function Avatar({ name = '', src, size = 'md', className = '' }) {
  if (src) {
    return (
      <AvatarImage
        key={src}
        name={name}
        src={src}
        size={size}
        className={className}
      />
    );
  }
  return <AvatarFallback name={name} size={size} className={className} />;
}

export function VerifiedBadge({ className = '' }) {
  return (
    <span
      className={cn('badge-green gap-1', className)}
      title="Identity and skills verified by FixitNow"
    >
      <Icon name="badge-check" className="h-3.5 w-3.5" />
      Verified
    </span>
  );
}

export function StatusBadge({ status, className = '' }) {
  return (
    <span className={cn(STATUS_STYLES[status] || 'badge-slate', className)}>
      {titleCase(status || '')}
    </span>
  );
}

export function Stars({ value = 0, count, size = 'sm', showValue = true }) {
  const starSize = size === 'lg' ? 'h-5 w-5' : size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';
  return (
    <span className="inline-flex items-center gap-1">
      <span className="flex items-center gap-0.5 text-amber-400">
        {[1, 2, 3, 4, 5].map((star) => (
          <Icon
            key={star}
            name="star"
            className={cn(starSize, star <= Math.round(Number(value)) ? 'text-amber-400' : 'text-slate-200')}
            fill="currentColor"
            strokeWidth={0}
          />
        ))}
      </span>
      {showValue && (
        <span className="text-xs font-semibold text-slate-700">
          {Number(value || 0).toFixed(1)}
          {count !== undefined && <span className="ml-1 font-normal text-slate-400">({count})</span>}
        </span>
      )}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, backTo, backLabel }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {backTo && (
          <Link
            to={backTo}
            className="mb-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
          >
            <Icon name="chevron-left" className="h-4 w-4" />
            {backLabel || 'Back'}
          </Link>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon = 'inbox', title, text, action, className = '' }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="mb-4 rounded-2xl bg-slate-100 p-4 text-slate-400">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'We could not load this page.', onRetry }) {
  return (
    <div className="card mx-auto max-w-lg px-6 py-12 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
        <Icon name="alert-triangle" className="h-6 w-6" />
      </span>
      <h3 className="font-semibold text-slate-900">Something went wrong</h3>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-5" onClick={onRetry}>
          <Icon name="refresh" className="h-4 w-4" />
          Try again
        </button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeydown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKeydown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeydown);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close modal" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl',
          sizes[size]
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(92vh-8rem)] overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, required, children, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="mt-5 flex items-center justify-between gap-3">
      <p className="text-xs text-slate-500">
        Page {meta.page} of {meta.totalPages} · {meta.total} results
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPage(meta.page - 1)}
          disabled={meta.page <= 1}
        >
          <Icon name="chevron-left" className="h-4 w-4" />
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onPage(meta.page + 1)}
          disabled={meta.page >= meta.totalPages}
        >
          Next
          <Icon name="chevron-right" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SkeletonCards({ count = 3, className = 'h-40' }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={cn('skeleton', className)} />
      ))}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}