import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api, { getToken, setToken, TOKEN_KEY } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(getToken());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let syncId = 0;

    function onToken(event) {
      setTokenState(event.detail);
    }

    function onExpired() {
      queryClient.clear();
      setUser(null);
      setTokenState(null);
    }

    function onStorage(event) {
      if (event.key !== TOKEN_KEY) return;

      const nextToken = event.newValue;
      const currentSyncId = ++syncId;
      queryClient.clear();
      setTokenState(nextToken);
      setUser(null);

      if (!nextToken) {
        setLoading(false);
        return;
      }

      setLoading(true);
      api.get('/auth/me', { headers: { Authorization: `Bearer ${nextToken}` } })
        .then((response) => {
          if (active && currentSyncId === syncId && getToken() === nextToken) {
            setUser(response.data.data.user);
          }
        })
        .catch(() => {
          if (active && currentSyncId === syncId && getToken() === nextToken) {
            setToken(null);
            setUser(null);
            setLoading(false);
          }
        })
        .finally(() => {
          if (active && currentSyncId === syncId && getToken() === nextToken) {
            setLoading(false);
          }
        });
    }

    window.addEventListener('session:token', onToken);
    window.addEventListener('session:expired', onExpired);
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      window.removeEventListener('session:token', onToken);
      window.removeEventListener('session:expired', onExpired);
      window.removeEventListener('storage', onStorage);
    };
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      const currentToken = getToken();
      if (!currentToken) {
        setLoading(false);
        return;
      }
      try {
        const response = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (active && getToken() === currentToken) setUser(response.data.data.user);
      } catch {
        if (active && getToken() === currentToken) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active && getToken() === currentToken) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const response = await api.post('/auth/login', credentials);
    const { accessToken, user: nextUser } = response.data.data;
    queryClient.clear();
    setToken(accessToken);
    setUser(nextUser);
    return nextUser;
  }, [queryClient]);

  const register = useCallback(async (payload) => {
    const response = await api.post('/auth/register', payload);
    const { accessToken, user: nextUser } = response.data.data;
    queryClient.clear();
    setToken(accessToken);
    setUser(nextUser);
    return nextUser;
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the request fails, clear the local session.
    }
    queryClient.clear();
    setToken(null);
    setUser(null);
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    const response = await api.get('/auth/me');
    setUser(response.data.data.user);
    return response.data.data.user;
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refreshUser, updateUser }),
    [user, token, loading, login, register, logout, refreshUser, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function roleHome(role) {
  if (role === 'admin') return '/admin';
  if (role === 'technician') return '/technician';
  return '/dashboard';
}