import { jest } from '@jest/globals';

const emitToUser = jest.fn();
const isOnline = jest.fn();
const notifyUser = jest.fn();
const Conversation = {};
const Message = {
  create: jest.fn(),
  findByPk: jest.fn(),
};

jest.unstable_mockModule('../models/index.js', () => ({ Conversation, Message }));
jest.unstable_mockModule('../middleware/upload.js', () => ({
  publicFileUrl: (url) => url,
}));
jest.unstable_mockModule('../sockets/registry.js', () => ({ emitToUser }));
jest.unstable_mockModule('../sockets/presence.js', () => ({ isOnline }));
jest.unstable_mockModule('./notification.service.js', () => ({ notifyUser }));

const { createMessage } = await import('./chat.service.js');

describe('createMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isOnline.mockReturnValue(true);
    notifyUser.mockResolvedValue({});

    const message = {
      id: 9,
      conversationId: 44,
      senderId: 1,
      type: 'text',
      body: 'Hello',
      createdAt: new Date(),
      toJSON() {
        return { ...this };
      },
    };
    Message.create.mockResolvedValue(message);
    Message.findByPk.mockResolvedValue(message);
  });

  it('notifies the recipient when they are already online', async () => {
    const conversation = {
      id: 44,
      customerId: 1,
      technicianId: 2,
      update: jest.fn().mockResolvedValue(undefined),
    };

    await createMessage({
      conversation,
      sender: { id: 1, name: 'Customer' },
      body: 'Hello',
    });

    expect(notifyUser).toHaveBeenCalledWith({
      userId: 2,
      type: 'chat_message',
      title: 'New message from Customer',
      body: 'Hello',
      data: {
        conversationId: 44,
        messageId: 9,
        url: '/messages?conversation=44',
      },
    });
  });
});
