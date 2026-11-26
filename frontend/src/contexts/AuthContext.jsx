// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { safeStorage } from '../utils/safeStorage';
import { subscribeToPush } from '../utils/pushManager';
import { API_BASE } from '../config';

// Set withCredentials globally — all axios requests include cookies
axios.defaults.withCredentials = true;

// Set CSRF header globally for all requests
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be within AuthProvider');
  return ctx;
}

async function bindDevice(unlink = false, username) {
  const reg = await navigator.serviceWorker?.getRegistration();
  const subscription = await reg?.pushManager?.getSubscription();
  if (!subscription && !unlink && username && window.Notification?.permission === 'granted' &&
      safeStorage.getItem('gridlock_push') !== 'false' && import.meta.env.PROD) {
    if (await subscribeToPush(username)) safeStorage.setItem('gridlock_push', 'true');
    return;
  }
  if (subscription) await axios.post(API_BASE + '/api/push/device-account', {
    endpoint: subscription.endpoint, auth: subscription.toJSON().keys.auth, unlink,
  });
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    axios.get(`${API_BASE}/api/auth/me`, { signal: controller.signal })
      .then(res => {
        if (!controller.signal.aborted) setUser(res.data.user);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUser(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (user?.usernameSetupComplete) bindDevice(false, user.username).catch(() => {});
  }, [user]);

  const login = useCallback(() => {
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `${API_BASE}/api/auth/google?returnTo=${returnTo}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await bindDevice(true).catch(() => {});
      await axios.post(`${API_BASE}/api/auth/logout`);
    } catch {
      // Ignore errors — clear user either way
    }
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/auth/me`);
      setUser(res.data.user);
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
