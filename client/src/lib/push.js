import api from './api';

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    bytes[index] = rawData.charCodeAt(index);
  }
  return bytes;
}

export async function fetchPushConfig() {
  const subscription = await getLocalPushSubscription();
  const response = await api.get('/notifications/push/config', {
    params: subscription ? { endpoint: subscription.endpoint } : {},
  });
  return response.data.data;
}

export async function getLocalPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function subscribeToPush(publicKey) {
  if (!isPushSupported()) {
    throw new Error('This browser does not support desktop notifications.');
  }
  if (!publicKey) {
    throw new Error('Push notifications are not configured on the server.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was denied in your browser settings.');
  }

  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) =>
      window.setTimeout(() => reject(new Error('Service worker is not ready yet')), 6000)
    ),
  ]);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const details = subscription.toJSON();
  await api.post('/notifications/push/subscribe', {
    endpoint: details.endpoint,
    keys: { p256dh: details.keys.p256dh, auth: details.keys.auth },
    userAgent: navigator.userAgent.slice(0, 255),
  });
  return true;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  const details = subscription.toJSON();
  await api.post('/notifications/push/unsubscribe', { endpoint: details.endpoint });
  await subscription.unsubscribe();
  return true;
}
