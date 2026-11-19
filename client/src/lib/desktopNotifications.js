export function showDesktopNotification({ id, title, body, url, tag }) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const instance = new Notification(title, {
      body: body || '',
      tag: tag || `fixitnow-${id}`,
      icon: '/icons/icon-192.png',
      data: { url: url || '/notifications' },
    });
    instance.onclick = () => {
      window.focus();
      const target = new URL(url || '/notifications', window.location.origin).href;
      window.location.assign(target);
    };
  } catch {
    return;
  }
}
