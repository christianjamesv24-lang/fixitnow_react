import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../lib/api';
import Icon from '../components/Icon';
import { EmptyState, ErrorState, PageHeader, Pagination, Spinner } from '../components/ui';
import { useToast } from '../contexts/ToastContext';
import { cn, timeAgo } from '../lib/utils';
import DesktopNotificationOptIn from '../components/DesktopNotificationOptIn';

const TYPE_ICONS = {
  request_created: 'clipboard',
  request_available: 'briefcase',
  request_assigned: 'clipboard',
  request_accepted: 'check',
  request_declined: 'x',
  status_changed: 'activity',
  schedule_changed: 'calendar',
  job_reminder: 'clock',
  chat_message: 'message',
  verification_submitted: 'shield-check',
  verification_decision: 'shield-check',
  new_review: 'star',
  review_reply: 'message',
  announcement: 'bell',
  system: 'info',
};

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['notifications', 'list', page],
    queryFn: () => api.get('/notifications', { params: { page, limit: 15 } }).then((res) => res.data.data),
  });

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  async function openNotification(notification) {
    if (!notification.readAt) markRead.mutate(notification.id);
    if (notification.data?.url) {
      navigate(notification.data.url);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="Live updates about requests, chat, verification and reviews."
        actions={
          <>
            <DesktopNotificationOptIn compact />
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || !data?.unread}
            >
              {markAll.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="check-check" className="h-4 w-4" />}
              Mark all as read
            </button>
          </>
        }
      />

      <div className="card overflow-hidden">
        {isLoading && (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((item) => <div key={item} className="skeleton h-16" />)}
          </div>
        )}
        {isError && <ErrorState message="Could not load your notifications." onRetry={refetch} />}
        {data?.items?.length === 0 && (
          <EmptyState
            icon="bell"
            title="All caught up"
            text="You will see request updates, chat messages and verification decisions here."
          />
        )}
        <ul className="divide-y divide-slate-100">
          {(data?.items || []).map((notification) => {
            const inner = (
              <>
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    notification.readAt ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-700'
                  )}
                >
                  <Icon name={TYPE_ICONS[notification.type] || 'bell'} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className={cn('text-sm', notification.readAt ? 'font-medium text-slate-700' : 'font-bold text-slate-900')}>
                      {notification.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-400">{timeAgo(notification.createdAt)}</span>
                  </span>
                  {notification.body && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{notification.body}</span>
                  )}
                </span>
                {!notification.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-600" />}
              </>
            );
            return (
              <li key={notification.id}>
                {notification.data?.url ? (
                  <Link
                    to={notification.data.url}
                    onClick={() => openNotification(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50',
                      !notification.readAt && 'bg-brand-50/40'
                    )}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-slate-50',
                      !notification.readAt && 'bg-brand-50/40'
                    )}
                  >
                    {inner}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {data?.meta && (
          <div className="px-4 pb-4">
            <Pagination meta={data.meta} onPage={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}