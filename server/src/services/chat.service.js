import { Op } from 'sequelize';
import { Conversation, Message } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import { publicFileUrl } from '../middleware/upload.js';
import { emitToUser } from '../sockets/registry.js';
import { isOnline } from '../sockets/presence.js';
import { notifyUser } from './notification.service.js';

export const PARTICIPANT_ATTRIBUTES = [
  'id',
  'name',
  'role',
  'avatarUrl',
  'phone',
  'lastActiveAt',
];

const CONVERSATION_INCLUDES = [
  { association: 'customer', attributes: PARTICIPANT_ATTRIBUTES },
  { association: 'technician', attributes: PARTICIPANT_ATTRIBUTES },
  {
    association: 'request',
    attributes: ['id', 'status', 'preferredDate', 'timeSlot', 'city', 'technicianId', 'customerId'],
    include: [{ association: 'category', attributes: ['id', 'name', 'icon'] }],
  },
];

export function participantIds(conversation) {
  return [Number(conversation.customerId), Number(conversation.technicianId)];
}

export function isParticipant(conversation, userId) {
  return participantIds(conversation).includes(Number(userId));
}

export function recipientId(conversation, senderId) {
  if (Number(conversation.customerId) === Number(senderId)) {
    return Number(conversation.technicianId);
  }
  if (Number(conversation.technicianId) === Number(senderId)) {
    return Number(conversation.customerId);
  }
  return null;
}

export function messageJSON(message) {
  const raw = message.toJSON ? message.toJSON() : { ...message };
  if (raw.imageUrl) raw.imageUrl = publicFileUrl(raw.imageUrl);
  if (raw.locationShare) {
    raw.locationShare = {
      id: raw.locationShare.id,
      lat: Number(raw.locationShare.lat),
      lng: Number(raw.locationShare.lng),
      mode: raw.locationShare.mode,
      expiresAt: raw.locationShare.expiresAt,
      stoppedAt: raw.locationShare.stoppedAt,
    };
  }
  return raw;
}

export function conversationJSON(conversation) {
  const raw = conversation.toJSON ? conversation.toJSON() : { ...conversation };
  if (raw.request?.category) {
    raw.request.category = {
      id: raw.request.category.id,
      name: raw.request.category.name,
      icon: raw.request.category.icon,
    };
  }
  return raw;
}

export async function loadConversation(id, viewer, { includeMessages = false } = {}) {
  const conversation = await Conversation.findByPk(id, {
    include: includeMessages
      ? [...CONVERSATION_INCLUDES, { association: 'messages', limit: 1, order: [['createdAt', 'DESC']] }]
      : CONVERSATION_INCLUDES,
  });
  if (!conversation) throw ApiError.notFound('Conversation not found');
  if (viewer.role !== 'admin' && !isParticipant(conversation, viewer.id)) {
    throw ApiError.notFound('Conversation not found');
  }
  return conversation;
}

export function assertCanSend(conversation, sender) {
  if (!isParticipant(conversation, sender.id)) {
    throw ApiError.forbidden('You cannot send messages in this conversation');
  }
  if (conversation.request) {
    if (conversation.request.status === 'cancelled') {
      throw ApiError.conflict('This conversation is closed because the request was cancelled');
    }
    if (conversation.request.status === 'pending') {
      throw ApiError.conflict('Chat opens after a technician accepts the request');
    }
  }
}

/** Reuses the one request conversation, rotating it to a newly assigned technician. */
export async function ensureRequestConversation(request) {
  if (!request?.technicianId) {
    throw ApiError.badRequest('A technician must be assigned before chat opens');
  }
  let conversation = await Conversation.findOne({ where: { requestId: request.id } });
  if (conversation) {
    if (Number(conversation.technicianId) !== Number(request.technicianId)) {
      await Message.destroy({ where: { conversationId: conversation.id } });
      await conversation.update({
        customerId: request.customerId,
        technicianId: request.technicianId,
        lastMessageAt: null,
      });
    }
    return conversation;
  }
  conversation = await Conversation.create({
    requestId: request.id,
    customerId: request.customerId,
    technicianId: request.technicianId,
  });
  return conversation;
}

export function findExistingConsultation(customerId, technicianId) {
  return Conversation.findOne({
    where: { customerId, technicianId, requestId: null },
    order: [['createdAt', 'ASC']],
  });
}

export async function createMessage({
  conversation,
  sender,
  type = 'text',
  body = null,
  imageUrl = null,
  locationShareId = null,
  notify = true,
}) {
  assertCanSend(conversation, sender);
  const text = body === null || body === undefined ? null : String(body).trim();
  if (type === 'text' && !text) throw ApiError.badRequest('Write a message before sending');
  if (type === 'image' && !imageUrl) throw ApiError.badRequest('An image is required');
  if (text && text.length > 4000) {
    throw ApiError.badRequest('Messages must be 4000 characters or fewer');
  }

  const recipient = recipientId(conversation, sender.id);
  const online = recipient ? isOnline(recipient) : false;
  const now = new Date();

  const message = await Message.create({
    conversationId: conversation.id,
    senderId: sender.id,
    type,
    body: type === 'text' ? text : text || null,
    imageUrl,
    locationShareId,
    deliveredAt: online ? now : null,
  });
  await conversation.update({ lastMessageAt: message.createdAt });

  const full = await Message.findByPk(message.id, {
    include: [
      { association: 'sender', attributes: ['id', 'name', 'avatarUrl', 'role'] },
      ...(locationShareId ? [{ association: 'locationShare' }] : []),
    ],
  });
  const payload = messageJSON(full);

  for (const userId of participantIds(conversation)) {
    emitToUser(userId, 'chat:message', payload);
  }

  if (notify && recipient) {
    const preview =
      type === 'image'
        ? 'Sent a photo'
        : type === 'location'
          ? 'Shared their current location'
          : text.length > 90
            ? `${text.slice(0, 87)}...`
            : text;
    try {
      await notifyUser({
        userId: recipient,
        type: 'chat_message',
        title: `New message from ${sender.name}`,
        body: preview,
        data: {
          conversationId: conversation.id,
          messageId: message.id,
          url: `/messages?conversation=${conversation.id}`,
        },
      });
    } catch (error) {
      console.error('Chat notification failed:', error.message);
    }
  }

  return payload;
}

export async function markConversationRead(conversation, reader) {
  if (!isParticipant(conversation, reader.id)) {
    throw ApiError.forbidden('You are not part of this conversation');
  }
  const now = new Date();
  const [updated] = await Message.update(
    {
      seenAt: now,
      deliveredAt: now,
    },
    {
      where: {
        conversationId: conversation.id,
        senderId: { [Op.ne]: reader.id },
        seenAt: null,
      },
    }
  );

  const recipient = recipientId(conversation, reader.id);
  if (recipient) {
    emitToUser(recipient, 'chat:read', {
      conversationId: conversation.id,
      readerId: reader.id,
      seenAt: now,
    });
  }
  return { updated, seenAt: now };
}

export function unreadConversationIds(conversations, userId) {
  return conversations
    .filter((conversation) => isParticipant(conversation, userId))
    .map((conversation) => conversation.id);
}

export async function countUnread(conversationIds, userId) {
  if (!conversationIds.length) return 0;
  return Message.count({
    where: {
      conversationId: { [Op.in]: conversationIds },
      senderId: { [Op.ne]: userId },
      seenAt: null,
    },
  });
}