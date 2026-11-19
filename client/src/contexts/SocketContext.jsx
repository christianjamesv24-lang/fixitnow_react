import { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { showDesktopNotification } from '../lib/desktopNotifications';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!token || !user) {
      setSocket(null);
      setConnected(false);
      return undefined;
    }
    const instance = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    setSocket(instance);
    const onConnect = () => {
      setConnected(true);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    const onDisconnect = () => setConnected(false);
    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.disconnect();
    };
  }, [token, user, queryClient]);

  useEffect(() => {
    if (!socket) return undefined;

    const onNotification = (notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (!notification?.title) return;
      showDesktopNotification({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        url: notification.data?.url,
        tag: `notification-${notification.id}`,
      });
      toast.info(notification.body || notification.title, { title: notification.title });
    };
    const onChatMessage = (message) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (!message || Number(message.senderId) === Number(user?.id)) return;
      const title = `New message from ${message?.sender?.name || 'FixitNow'}`;
      const body = message?.type === 'image' ? 'Photo' : message?.type === 'location' ? 'Shared a location' : message?.body || '';
      showDesktopNotification({
        title,
        body,
        url: `/messages?conversation=${message.conversationId}`,
        tag: `chat-${message.id}`,
      });
      toast.info(body || 'New message', { title });
    };
    const onRequestCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['technician', 'jobs'] });
    };
    const onTechnicianChanged = () => {
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
    };

    socket.on('notification:new', onNotification);
    socket.on('chat:message', onChatMessage);
    socket.on('request:created', onRequestCreated);
    socket.on('technician:verified', onTechnicianChanged);
    socket.on('technician:updated', onTechnicianChanged);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('chat:message', onChatMessage);
      socket.off('request:created', onRequestCreated);
      socket.off('technician:verified', onTechnicianChanged);
      socket.off('technician:updated', onTechnicianChanged);
    };
  }, [socket, queryClient, toast, user?.id]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}