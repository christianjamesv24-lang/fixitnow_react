import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const Notification = { bulkCreate: jest.fn() };
const User = { findAll: jest.fn() };

jest.unstable_mockModule('../models/index.js', () => ({ Notification, User }));

const { createAnnouncementNotifications } = await import('./announcementNotification.service.js');

describe('createAnnouncementNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates notifications for active customers and technicians for an all-audience announcement', async () => {
    const transaction = {};
    const announcement = {
      id: 8,
      role: 'all',
      title: 'Service update',
      text: 'We have improved the booking experience.',
      isActive: true,
      sentNotification: false,
      update: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = [{ id: 1 }, { id: 2 }];
    User.findAll.mockResolvedValue([{ id: 4 }, { id: 9 }]);
    Notification.bulkCreate.mockResolvedValue(notifications);

    await expect(createAnnouncementNotifications(announcement, { transaction })).resolves.toBe(notifications);

    expect(User.findAll).toHaveBeenCalledWith({
      where: { role: { [Op.in]: ['customer', 'technician'] }, isActive: true },
      attributes: ['id'],
      transaction,
    });
    expect(Notification.bulkCreate).toHaveBeenCalledWith([
      {
        userId: 4,
        type: 'announcement',
        title: 'Service update',
        body: 'We have improved the booking experience.',
        data: { announcementId: 8, url: '/notifications' },
      },
      {
        userId: 9,
        type: 'announcement',
        title: 'Service update',
        body: 'We have improved the booking experience.',
        data: { announcementId: 8, url: '/notifications' },
      },
    ], { transaction });
    expect(announcement.update).toHaveBeenCalledWith({ sentNotification: true }, { transaction });
  });

  it.each([
    ['inactive', { isActive: false, sentNotification: false }],
    ['already sent', { isActive: true, sentNotification: true }],
  ])('does not send an %s announcement again', async (_label, state) => {
    const announcement = { ...state, role: 'all', update: jest.fn() };

    await expect(createAnnouncementNotifications(announcement, { transaction: {} })).resolves.toEqual([]);

    expect(User.findAll).not.toHaveBeenCalled();
    expect(Notification.bulkCreate).not.toHaveBeenCalled();
    expect(announcement.update).not.toHaveBeenCalled();
  });
});
