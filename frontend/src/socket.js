// src/socket.js
// Singleton socket instance shared across all components
import io from 'socket.io-client';

const socketUrl = import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

// Initialize socket once and export it
const socket = io(socketUrl, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
});

export default socket;
