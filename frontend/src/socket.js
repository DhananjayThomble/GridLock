// src/socket.js
// Singleton socket instance shared across all components
import io from 'socket.io-client';

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

export default socket;
