import webpush from 'web-push';
import { env } from '../config/env.js';
import { PushSubscription, User } from '../models/index.js';

let configured = false;

export function configurePush() {
  if (env.vapid.publicKey && env.vapid.privateKey) {
    webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
    configured = true;
  }
  return configured;
}

export function isPushConfigured() {
  return configured;
}

/**
 * Sends a Web Push payload to every device of a user. Expired endpoints
 * (404/410) are removed - section 9 explicitly allows that cleanup.
 */
export async function sendPushToUser(userId, payload) {
  if (!configured) return;
  const user = await User.findByPk(userId);
  if (!user || !user.pushEnabled) return;

  const subscriptions = await PushSubscription.findAll({ where: { userId } });
  const results = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      };
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await subscription.destroy();
          return;
        }
        throw error;
      }
    })
  );
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Push notification delivery failed.', {
        userId,
        statusCode: result.reason?.statusCode,
      });
    }
  });
}