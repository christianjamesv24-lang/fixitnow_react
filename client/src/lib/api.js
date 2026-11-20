import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
export const TOKEN_KEY = 'fixitnow_access_token';

export function publicAssetUrl(url) {
  if (!url) return '';
  try {
    return new URL(url, new URL(API_BASE, window.location.origin)).toString();
  } catch {
    return url;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent('session:token', { detail: token || null }));
}

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise = null;

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/auth/refresh`, null, { withCredentials: true })
      .then((response) => {
        const token = response.data?.data?.accessToken;
        if (token) setToken(token);
        return token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const url = original?.url || '';
    const isAuthEndpoint = /\/auth\/(login|register|refresh)/.test(url);
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isAuthEndpoint &&
      !original.skipAuthRefresh
    ) {
      original._retry = true;
      try {
        const token = await refreshAccessToken();
        if (token) {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        }
      } catch {
        setToken(null);
        window.dispatchEvent(new CustomEvent('session:expired'));
      }
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const data = error?.response?.data;
  if (data?.errors?.length) return data.errors.map((item) => item.message).join(' ');
  return data?.message || error?.message || fallback;
}

export default api;