import { z } from 'zod';

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(500),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(255),
    auth: z.string().trim().min(1).max(255),
  }),
  userAgent: z.string().max(255).optional(),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(500),
});
