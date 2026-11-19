import { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

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
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    instance.on('connect', onConnect);
    instance.on('disconnect', onDisconnect);
    return () => {
      instance.off('connect', onConnect);
      instance.off('disconnect', onDisconnect);
      instance.disconnect();
    };
  }, [token, user]);

  useEffect(() => {
    if (!socket) return undefined;

    const onNotification = (notification) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (notification?.title) toast.info(notification.body || notification.title, { title: notification.title });
    };
    const onRequestCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['technician', 'jobs'] });
    };
    const onTechnicianChanged = () => {
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
    };

    socket.on('notification:new', onNotification);
    socket.on('request:created', onRequestCreated);
    socket.on('technician:verified', onTechnicianChanged);
    socket.on('technician:updated', onTechnicianChanged);
    return () => {
      socket.off('notification:new', onNotification);
      socket.off('request:created', onRequestCreated);
      socket.off('technician:verified', onTechnicianChanged);
      socket.off('technician:updated', onTechnicianChanged);
    };
  }, [socket, queryClient, toast]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}