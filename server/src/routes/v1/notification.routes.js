import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  pushConfig,
  subscribePush,
  unsubscribePush,
} from '../../controllers/notification.controller.js';
import {
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
} from '../../validators/notification.schema.js';

const router = Router();
router.use(authenticate);

router.get('/', listNotifications);
router.get('/unread-count', unreadCount);
router.get('/push/config', pushConfig);
router.post('/push/subscribe', validateBody(pushSubscriptionSchema), subscribePush);
router.post('/push/unsubscribe', validateBody(pushUnsubscribeSchema), unsubscribePush);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);
router.delete('/:id', deleteNotification);

export default router;