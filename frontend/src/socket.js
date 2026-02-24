// src/socket.js
// Singleton socket instance shared across all components
import io from 'socket.io-client';

// Initialize socket once and export it
const socket = io({
    path: '/socket.io/',
    transports: ['websocket', 'polling']
});

export default socket;
