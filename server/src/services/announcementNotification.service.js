import { Op } from 'sequelize';
import { Notification, User } from '../models/index.js';

export async function createAnnouncementNotifications(announcement, { transaction }) {
  if (!announcement.isActive || announcement.sentNotification) return [];

  const roles = announcement.role === 'all'
    ? ['customer', 'technician']
    : [announcement.role];
  const users = await User.findAll({
    where: { role: { [Op.in]: roles }, isActive: true },
    attributes: ['id'],
    transaction,
  });
  const notifications = await Notification.bulkCreate(
    users.map(({ id }) => ({
      userId: id,
      type: 'announcement',
      title: announcement.title,
      body: announcement.text.slice(0, 600),
      data: { announcementId: announcement.id, url: '/notifications' },
    })),
    { transaction }
  );

  await announcement.update({ sentNotification: true }, { transaction });
  return notifications;
}
