// src/socket.js
// Singleton socket instance shared across all components
import io from 'socket.io-client';

const socketUrl = import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

// Initialize socket with auto-reconnection configured
const socket = io(socketUrl, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  // Reconnection settings
  reconnection: true,
  reconnectionAttempts: 10,        // Try up to 10 times
  reconnectionDelay: 1000,         // Start at 1s
  reconnectionDelayMax: 5000,      // Cap at 5s
  timeout: 20000,                  // Connection timeout
  // Send auth data on reconnect so backend can restore session
  auth: {},
});

export default socket;
