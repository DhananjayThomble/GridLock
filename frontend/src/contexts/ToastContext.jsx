// src/contexts/ToastContext.jsx
// Toast notification context — provides showToast() to any component
/* eslint-disable react-refresh/only-export-components */

import React, { useState, useCallback, useRef, createContext, useContext } from 'react';

const ToastContext = createContext(null);

/**
 * Hook to show toast notifications from any component.
 * @returns {{ showToast: (message: string, options?: { type?: 'info'|'error'|'success', duration?: number }) => void }}
 */
export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
};

const ICON_MAP = { info: 'ℹ️', error: '⚠️', success: '✅' };
const BG_MAP = {
  info: 'color-mix(in srgb, var(--accent) 15%, var(--bg-tertiary))',
  error: 'color-mix(in srgb, var(--danger) 15%, var(--bg-tertiary))',
  success: 'color-mix(in srgb, var(--success) 15%, var(--bg-tertiary))',
};
const BORDER_MAP = {
  info: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  error: 'color-mix(in srgb, var(--danger) 40%, transparent)',
  success: 'color-mix(in srgb, var(--success) 40%, transparent)',
};

const ToastItem = ({ toast, onDone }) => {
  const [visible, setVisible] = useState(false);

  React.useEffect(() => {
    const enterTimer = requestAnimationFrame(() => setVisible(true));
    const exitTimer = setTimeout(() => setVisible(false), toast.duration - 300);
    const removeTimer = setTimeout(onDone, toast.duration);
    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.duration, onDone]);

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        pointerEvents: 'auto',
        padding: '10px 16px',
        borderRadius: 12,
        background: BG_MAP[toast.type] || BG_MAP.info,
        border: `1px solid ${BORDER_MAP[toast.type] || BORDER_MAP.info}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-12px)',
        transition: 'opacity 0.3s, transform 0.3s',
      }}
    >
      <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{ICON_MAP[toast.type] || ICON_MAP.info}</span>
      <span>{toast.message}</span>
    </div>
  );
};

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const showToast = useCallback((message, { type = 'info', duration = 4000 } = {}) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
          width: '90%',
          maxWidth: 400,
        }}
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export default ToastProvider;
