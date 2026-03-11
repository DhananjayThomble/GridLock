// src/socket.js
// Singleton socket instance shared across all components
// Configured with auto-reconnect and exponential backoff
import io from 'socket.io-client';

const socketUrl = import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

/** Reconnection configuration constants */
const RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 1000;
const RECONNECT_DELAY_MAX_MS = 10000;

// Initialize socket once and export it
const socket = io(socketUrl, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: RECONNECT_ATTEMPTS,
  reconnectionDelay: RECONNECT_DELAY_MS,
  reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
  timeout: 20000,
});

export default socket;
export { RECONNECT_ATTEMPTS, RECONNECT_DELAY_MS, RECONNECT_DELAY_MAX_MS };
