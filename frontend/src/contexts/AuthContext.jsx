// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_BASE}/api/auth/me`)
      .then(res => setUser(res.data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(() => {
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `${API_BASE}/api/auth/google?returnTo=${returnTo}`;
  }, []);

  const logout = useCallback(async () => {
    try {
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
