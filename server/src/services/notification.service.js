import { Notification } from '../models/index.js';
import { emitToUser } from '../sockets/registry.js';
import { sendPushToUser } from './push.service.js';

export async function createNotification(values, { transaction } = {}) {
  return Notification.create(
    {
      userId: values.userId,
      type: values.type,
      title: values.title,
      body: values.body || null,
      data: values.data || {},
    },
    { transaction }
  );
}

/** Sends the live in-app event and a push notification for a stored row. */
export async function dispatchNotification(notification) {
  if (!notification) return;
  emitToUser(notification.userId, 'notification:new', {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  });
  try {
    await sendPushToUser(notification.userId, {
      title: notification.title,
      body: notification.body || '',
      url: notification.data?.url || '/notifications',
      tag: `notification-${notification.id}`,
    });
  } catch (error) {
    console.error('Push notification dispatch failed.', {
      userId: notification.userId,
      message: error.message,
    });
  }
}

/** Convenience for notification-only events (chat, announcements, reminders). */
export async function notifyUser(values) {
  const notification = await createNotification(values);
  await dispatchNotification(notification);
  return notification;
}