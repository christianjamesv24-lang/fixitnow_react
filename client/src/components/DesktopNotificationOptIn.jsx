import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { fetchPushConfig, isPushSupported, subscribeToPush } from '../lib/push';
import { useToast } from '../contexts/ToastContext';
import { showDesktopNotification } from '../lib/desktopNotifications';

export default function DesktopNotificationOptIn({ compact = false }) {
  const toast = useToast();
  const [permission, setPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [busy, setBusy] = useState(false);
  const configQuery = useQuery({
    queryKey: ['push', 'config'],
    queryFn: fetchPushConfig,
    staleTime: 5 * 60 * 1000,
  });

  async function enable() {
    if (!isPushSupported()) {
      toast.error('This browser does not support desktop notifications.');
      return;
    }
    setBusy(true);
    try {
      const next = await Notification.requestPermission();
      setPermission(next);
      if (next !== 'granted') {
        toast.error('Notifications are blocked. Allow them in your browser site settings.');
        return;
      }
      if (!configQuery.data?.configured) {
        toast.error('Push notifications are not configured on the server.');
        return;
      }
      await subscribeToPush(configQuery.data.publicKey);
      await configQuery.refetch();
      showDesktopNotification({
        title: 'Notifications enabled',
        body: 'You will now be notified here for messages and updates.',
        url: '/notifications',
        tag: 'fixitnow-enabled',
      });
      toast.success('Desktop notifications enabled');
    } catch (error) {
      toast.error(error?.message || 'Could not enable desktop notifications');
    } finally {
      setBusy(false);
    }
  }

  const testMutation = useMutation({
    mutationFn: () => api.post('/notifications/push/test'),
    onSuccess: () => toast.success('Test notification sent to this device'),
    onError: () => toast.error('Could not send the test notification'),
  });

  if (permission === 'granted' && configQuery.data?.subscribed) {
    return (
      <button
        type="button"
        className={compact ? 'btn-ghost btn-sm' : 'btn-secondary btn-sm'}
        onClick={() => testMutation.mutate()}
        disabled={testMutation.isPending}
        title="Send a test notification"
      >
        Test notification
      </button>
    );
  }

  return (
    <button
      type="button"
      className={compact ? 'btn-ghost btn-sm' : 'btn-primary btn-sm'}
      onClick={enable}
      disabled={
        busy ||
        permission === 'unsupported' ||
        configQuery.isLoading ||
        !configQuery.data?.configured
      }
      title="Get notifications on this device"
    >
      {busy ? 'Enabling…' : 'Notify me'}
    </button>
  );
}
