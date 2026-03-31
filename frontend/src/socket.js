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
  reconnectionAttempts: 20,        // Give more chances on flaky mobile networks
  reconnectionDelay: 500,          // Start faster (500ms)
  reconnectionDelayMax: 10000,     // Allow longer backoff on really bad networks
  timeout: 20000,                  // Connection timeout
});

// ── Lifecycle reconnection constants ──────────────────────────────────────────
const LIVENESS_TIMEOUT_MS = 5000;     // Max wait for app_ping response
const FREEZE_THRESHOLD_MS = 30000;    // Force reconnect after frozen >30s
const STALE_THRESHOLD_MS = 60000;     // Consider connection stale after 60s without activity
const LIVENESS_DELAY_MS = 2000;       // Delay before liveness check after reconnect

// ── Connection liveness tracking ──────────────────────────────────────────────
// Track the last time we confirmed the connection is alive. Used by Page
// Lifecycle handlers to detect stale connections after freeze/resume/BFCache.
// Updated on connect and app_ping callbacks only (positive confirmation).
let lastAliveAt = Date.now();

// ── Sentry socket tracking ────────────────────────────────────────────────────

socket.on('connect', () => {
  socket.io.opts.reconnection = true;
  lastAliveAt = Date.now();

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
  captureException(new Error('Socket reconnection failed after all attempts'), {
    tags: { source: 'socket.reconnect_failed' },
  });
});

// ── Idle timeout handling (#390) ──────────────────────────────────────────────
// Server emits 'idle_timeout' before disconnecting idle sockets.
// Disable auto-reconnect and disconnect from client side to prevent Socket.IO
// from auto-reconnecting (P0 fix).
socket.on('idle_timeout', ({ reason, timeoutMs }) => {
  // Disable auto-reconnect BEFORE server disconnects us
  socket.io.opts.reconnection = false;

  addBreadcrumb({
    category: 'socket',
    message: `Idle timeout: ${reason}`,
    level: 'warning',
    data: { reason, timeoutMs },
  });
  console.warn(`[GridLock] Disconnected: idle timeout (${reason})`);

  // Disconnect from client side — voluntary client disconnect prevents auto-reconnect
  socket.disconnect();

  // Dispatch a custom event so UI components can show a reconnect prompt
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gridlock:idle_timeout', {
      detail: { reason, timeoutMs },
    }));
  }
});

// ── Force reconnect helper ────────────────────────────────────────────────────
// Cleanly disconnects and reconnects the socket, then dispatches a window event
// so components (Board.jsx) can re-emit join_game. We can't rely on Socket.IO's
// Manager 'reconnect' event because disconnect()+connect() creates a fresh
// connection, not a reconnection.
function forceReconnect(reason) {
  addBreadcrumb({ category: 'socket', message: `Force reconnect: ${reason}`, level: 'warning' });
  socket.disconnect();
  socket.connect();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gridlock:force_reconnect', { detail: { reason } }));
  }
}

// ── Liveness check ────────────────────────────────────────────────────────────
// After a freeze/resume or BFCache restore, socket.connected may return true
// even though the underlying connection is dead. This function verifies via a
// round-trip app_ping to the server.
let livenessCheckActive = false;

function checkLiveness() {
  if (!socket.connected || !socket.active) return;
  if (livenessCheckActive) return; // Already checking
  livenessCheckActive = true;

  const timeoutId = setTimeout(() => {
    livenessCheckActive = false;
    console.warn('[GridLock] Liveness check failed — forcing reconnect');
    addBreadcrumb({ category: 'socket', message: 'Liveness check timeout', level: 'error' });
    forceReconnect('liveness check timeout');
  }, LIVENESS_TIMEOUT_MS);

  socket.emit('app_ping', () => {
    clearTimeout(timeoutId);
    livenessCheckActive = false;
    lastAliveAt = Date.now();
  });
}

// ── Mobile reconnection helpers ───────────────────────────────────────────────
// When the user switches away (e.g. sharing a link on WhatsApp) and comes back,
// the socket may have silently disconnected. Force a reconnect on visibility
// change and network recovery so players don't appear as "disconnected".

// ── Page Lifecycle API handlers (#476, #477) ──────────────────────────────────
// These cover scenarios that visibilitychange alone cannot:
//   - iOS Safari screen lock (pageshow + event.persisted)
//   - Chrome/Edge tab freeze after ~5 min background (freeze/resume)
//   - BFCache back/forward restoration (pageshow + event.persisted)
//   - Browser tab discard (document.wasDiscarded)
if (typeof document !== 'undefined') {
  // ── document.wasDiscarded — page was discarded and reloaded ─────────────
  if (document.wasDiscarded) {
    console.log('[GridLock] Page was previously discarded by browser');
    addBreadcrumb({ category: 'socket', message: 'Page was discarded', level: 'warning' });
    // Socket will auto-connect on page load; Board reads sessionToken from localStorage
  }

  // ── visibilitychange — enhanced with elapsed-time stale detection ───────
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!socket.active) return; // Intentionally disconnected (idle_timeout)

    const elapsed = Date.now() - lastAliveAt;

    if (!socket.connected) {
      console.log('[GridLock] Tab visible, socket disconnected, reconnecting...');
      socket.connect();
    } else if (elapsed > STALE_THRESHOLD_MS) {
      // Connected but haven't heard from server in >60s — likely stale after freeze
      console.log(`[GridLock] Tab visible, ${Math.round(elapsed / 1000)}s since last activity — checking liveness`);
      checkLiveness();
    }
  });

  // ── freeze / resume — Chrome/Edge Page Lifecycle API ────────────────────
  // These events fire on `document`. addEventListener on a non-existent event
  // is a no-op, so no feature detection is needed.
  document.addEventListener('freeze', () => {
    lastAliveAt = Date.now(); // Record when we were frozen
    addBreadcrumb({ category: 'socket', message: 'Page frozen (tab freeze)', level: 'warning' });
    console.log('[GridLock] Page frozen by browser');
  });

  document.addEventListener('resume', () => {
    const elapsed = Date.now() - lastAliveAt;
    console.log(`[GridLock] Page resumed after ${Math.round(elapsed / 1000)}s`);
    addBreadcrumb({ category: 'socket', message: `Page resumed, ${elapsed}ms elapsed`, level: 'info' });

    if (!socket.active) return; // Intentionally disconnected (idle_timeout)

    if (elapsed > FREEZE_THRESHOLD_MS) {
      // Frozen for >30s — socket is almost certainly dead even if socket.connected says true
      console.log('[GridLock] Long freeze detected, forcing reconnect...');
      forceReconnect('long freeze');
      // Verify the reconnection is actually alive after a short delay
      setTimeout(() => checkLiveness(), LIVENESS_DELAY_MS);
    } else if (!socket.connected) {
      socket.connect();
    }
  });

  // ── pageshow — iOS Safari screen lock + BFCache restoration ─────────────
  // Fires on `window`, not `document`. Fires on every page load (including
  // initial), so we MUST check event.persisted to only handle BFCache restores.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      // Page was restored from BFCache — WebSocket is definitely dead
      const elapsed = Date.now() - lastAliveAt;
      console.log(`[GridLock] Page restored from BFCache (${Math.round(elapsed / 1000)}s elapsed)`);
      addBreadcrumb({ category: 'socket', message: `BFCache restore, ${elapsed}ms elapsed`, level: 'info' });
      if (socket.active) {
        // Force close stale connection and reconnect
        forceReconnect('BFCache restore');
        // Verify the reconnection is actually alive after a short delay
        setTimeout(() => checkLiveness(), LIVENESS_DELAY_MS);
      }
    }
  });

  // ── online — network recovery ───────────────────────────────────────────
  window.addEventListener('online', () => {
    if (!socket.active) return; // Intentionally disconnected (idle_timeout)
    if (!socket.connected) {
      console.log('[GridLock] Network back online, reconnecting socket...');
      socket.connect();
    }
  });
}

export default socket;
