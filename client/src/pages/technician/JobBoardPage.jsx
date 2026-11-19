import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import Icon from '../../components/Icon';
import { EmptyState, ErrorState, PageHeader, Pagination } from '../../components/ui';
import RequestCard from '../../components/requests/RequestCard';
import { cn } from '../../lib/utils';

const TABS = [
  { value: 'available', label: 'Available jobs', icon: 'briefcase' },
  { value: 'mine', label: 'My jobs', icon: 'clipboard' },
];

export default function JobBoardPage() {
  const [tab, setTab] = useState('available');
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ['technician', 'jobs', tab, page],
    queryFn: () =>
      api
        .get(tab === 'available' ? '/requests/available' : '/requests', {
          params: { page, limit: 10 },
        })
        .then((res) => res.data.data),
  });

  const verificationBlocked = query.isError && query.error?.response?.status === 403;

  function switchTab(next) {
    setTab(next);
    setPage(1);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Job board"
        subtitle="All open customer requests, plus every job assigned to you."
        actions={
          <button type="button" className="btn-secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
            <Icon name="refresh" className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
            Refresh
          </button>
        }
      />

      <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => switchTab(item.value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition',
              tab === item.value ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            )}
          >
            <Icon name={item.icon} className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {verificationBlocked ? (
        <div className="card mx-auto max-w-xl px-6 py-12 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <Icon name="shield-check" className="h-6 w-6" />
          </span>
          <h2 className="font-semibold text-slate-900">Verification required</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            Only verified technicians can browse and accept jobs. Submit your ID, certificate and
            clearance during the verification phase of onboarding.
          </p>
        </div>
      ) : query.isError ? (
        <ErrorState message="We could not load the job board." onRetry={query.refetch} />
      ) : (
        <>
          {query.isLoading && (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => <div key={item} className="skeleton h-28" />)}
            </div>
          )}
          {!query.isLoading && query.data?.items?.length === 0 && (
            <div className="card">
              <EmptyState
                icon={tab === 'available' ? 'briefcase' : 'clipboard'}
                title={tab === 'available' ? 'No matching open jobs' : 'No assigned jobs yet'}
                text={
                  tab === 'available'
                    ? 'New requests appear here as soon as a customer submits them. Check back soon.'
                    : 'Accept a job from the available tab and it will show up here.'
                }
                action={
                  tab === 'mine' ? (
                    <button type="button" className="btn-primary" onClick={() => switchTab('available')}>
                      Browse open jobs
                    </button>
                  ) : (
                    <Link to="/technician/profile" className="btn-secondary">
                      Update my profile
                    </Link>
                  )
                }
              />
            </div>
          )}
          <div className="space-y-3">
            {(query.data?.items || []).map((request) => (
              <RequestCard key={request.id} request={request} role="technician" />
            ))}
          </div>
          <Pagination meta={query.data?.meta} onPage={setPage} />
        </>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-500">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
        The board shows all open requests. Direct booking requests appear in My jobs before acceptance.
      </div>
    </div>
  );
}