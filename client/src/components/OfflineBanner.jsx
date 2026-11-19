import Icon from './Icon';
import useOnlineStatus from '../hooks/useOnlineStatus';

export default function OfflineBanner({ canQueueRequests = false }) {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-slate-900 px-4 py-2 text-xs font-semibold text-white">
      <Icon name="wifi-off" className="h-4 w-4 text-amber-300" />
      {canQueueRequests
        ? 'You are offline. Previously loaded requests are available, and new bookings will be sent when you reconnect.'
        : 'You are offline. Previously loaded requests are still available.'}
    </div>
  );
}