// src/socket.js
// Singleton socket instance shared across all components
import io from 'socket.io-client';
import { addBreadcrumb, captureException, setTag } from './lib/sentry';

const socketUrl = import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

// Initialize socket with auto-reconnection configured.
//
// Reconnect identity restoration:
// Socket.IO auth is NOT used for session identity. After a reconnect, each
// component (e.g. Board) re-emits join_game with its sessionToken to restore
// the player's seat. This is intentional — game state is component-driven,
// not transport-driven.
const socket = io(socketUrl, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  // Reconnection settings
  reconnection: true,
  reconnectionAttempts: 10,        // Try up to 10 times
  reconnectionDelay: 1000,         // Start at 1s
  reconnectionDelayMax: 5000,      // Cap at 5s
  timeout: 20000,                  // Connection timeout
});

// ── Sentry socket tracking ────────────────────────────────────────────────────

socket.on('connect', () => {
  addBreadcrumb({
    category: 'socket',
    message: 'Socket connected',
    level: 'info',
    data: { transport: socket.io?.engine?.transport?.name },
  });
  setTag('socket.transport', socket.io?.engine?.transport?.name);
});

socket.on('disconnect', (reason) => {
  addBreadcrumb({
    category: 'socket',
    message: `Socket disconnected: ${reason}`,
    level: 'warning',
    data: { reason },
  });
});

socket.on('connect_error', (error) => {
  addBreadcrumb({
    category: 'socket',
    message: `Socket connect_error: ${error.message}`,
    level: 'error',
    data: { message: error.message },
  });
  captureException(error, {
    tags: { source: 'socket.connect_error' },
  });
});

socket.io.on('reconnect', (attemptNumber) => {
  addBreadcrumb({
    category: 'socket',
    message: `Socket reconnected after ${attemptNumber} attempts`,
    level: 'info',
    data: { attemptNumber },
  });
});

socket.io.on('reconnect_failed', () => {
  addBreadcrumb({
    category: 'socket',
    message: 'Socket reconnection failed (exhausted attempts)',
    level: 'error',
  });
});

export default socket;
