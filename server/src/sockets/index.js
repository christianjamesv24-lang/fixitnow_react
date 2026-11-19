import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { setIo, emitToUser } from './registry.js';
import { addConnection, removeConnection } from './presence.js';
import {
  createMessage,
  isParticipant,
  loadConversation,
  markConversationRead,
  recipientId,
} from '../services/chat.service.js';

function respond(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

export function initSocket(server) {
  const io = new Server(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    // Forced WebSocket transport per the school requirement.
    transports: ['websocket'],
  });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = jwt.verify(token, env.jwt.accessSecret);
      const user = await User.findByPk(payload.sub);
      if (!user || !user.isActive) return next(new Error('Account is not active'));
      socket.user = { id: user.id, role: user.role, name: user.name };
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    socket.join(`role:${socket.user.role}`);
    const cameOnline = addConnection(userId, socket.id);
    await User.update({ lastActiveAt: new Date() }, { where: { id: userId } }).catch(() => {});

    if (cameOnline) {
      socket.broadcast.emit('presence:update', { userId, online: true });
    }

    socket.on('chat:send', async (payload, ack) => {
      try {
        const conversation = await loadConversation(payload?.conversationId, socket.user);
        if (socket.user.role === 'admin' || !isParticipant(conversation, socket.user.id)) {
          throw new Error('You cannot send messages in this conversation');
        }
        const message = await createMessage({
          conversation,
          sender: socket.user,
          type: 'text',
          body: payload?.body,
        });
        respond(ack, { ok: true, message });
      } catch (error) {
        respond(ack, { ok: false, error: error.message || 'Message could not be sent' });
      }
    });

    socket.on('chat:typing', async (payload) => {
      try {
        const conversation = await loadConversation(payload?.conversationId, socket.user);
        if (!isParticipant(conversation, socket.user.id)) return;
        const other = recipientId(conversation, socket.user.id);
        if (other) {
          emitToUser(other, 'chat:typing', {
            conversationId: conversation.id,
            userId: socket.user.id,
            name: socket.user.name,
            isTyping: Boolean(payload?.isTyping),
          });
        }
      } catch {
        // Typing indicators are best-effort and must not surface errors.
      }
    });

    socket.on('chat:read', async (payload, ack) => {
      try {
        const conversation = await loadConversation(payload?.conversationId, socket.user);
        if (socket.user.role === 'admin') {
          respond(ack, { ok: true });
          return;
        }
        await markConversationRead(conversation, socket.user);
        respond(ack, { ok: true });
      } catch (error) {
        respond(ack, { ok: false, error: error.message || 'Could not mark messages as read' });
      }
    });

    socket.on('disconnect', async () => {
      const wentOffline = removeConnection(userId, socket.id);
      if (wentOffline) {
        const lastActiveAt = new Date();
        await User.update({ lastActiveAt }, { where: { id: userId } }).catch(() => {});
        socket.broadcast.emit('presence:update', { userId, online: false, lastActiveAt });
      }
    });
  });

  return io;
}