// src/components/ReconnectionOverlay.jsx
// Displays a reconnecting/connection-lost overlay during WebSocket disconnects

import React, { useState, useEffect, useRef } from 'react';
import socket from '../socket';

/**
 * @typedef {'connected' | 'reconnecting' | 'failed'} ConnectionState
 */

/**
 * Overlay component that shows reconnection status.
 * Renders nothing when the socket is connected.
 *
 * @returns {React.ReactElement|null}
 */
const ReconnectionOverlay = () => {
    /** @type {[ConnectionState, React.Dispatch<React.SetStateAction<ConnectionState>>]} */
    const [connectionState, setConnectionState] = useState('connected');
    const [attempt, setAttempt] = useState(0);
    const reconnectTimerRef = useRef(null);

    useEffect(() => {
        const onConnect = () => {
            setConnectionState('connected');
            setAttempt(0);
        };

        const onDisconnect = (reason) => {
            // Don't show overlay for intentional disconnects
            if (reason === 'io client disconnect') return;
            setConnectionState('reconnecting');
        };

        const onReconnectAttempt = (attemptNumber) => {
            setAttempt(attemptNumber);
            setConnectionState('reconnecting');
        };

        const onReconnectFailed = () => {
            setConnectionState('failed');
        };

        const onReconnectError = () => {
            // Stay in reconnecting state; socket.io will keep trying
        };

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.io.on('reconnect_attempt', onReconnectAttempt);
        socket.io.on('reconnect_failed', onReconnectFailed);
        socket.io.on('reconnect_error', onReconnectError);

        // Check initial state
        if (!socket.connected) {
            setConnectionState('reconnecting');
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.io.off('reconnect_attempt', onReconnectAttempt);
            socket.io.off('reconnect_failed', onReconnectFailed);
            socket.io.off('reconnect_error', onReconnectError);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        };
    }, []);

    /**
     * Handle manual retry: reconnect the socket.
     */
    const handleRetry = () => {
        setConnectionState('reconnecting');
        setAttempt(0);
        socket.connect();
    };

    if (connectionState === 'connected') return null;

    return (
        <div
            className="reconnection-overlay"
            role="alert"
            aria-live="assertive"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                color: '#fff',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
        >
            {connectionState === 'reconnecting' && (
                <>
                    <div
                        className="reconnect-spinner"
                        style={{
                            width: 48,
                            height: 48,
                            border: '4px solid rgba(255, 255, 255, 0.3)',
                            borderTopColor: '#fff',
                            borderRadius: '50%',
                            animation: 'reconnect-spin 1s linear infinite',
                            marginBottom: 16,
                        }}
                    />
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 8px' }}>
                        Reconnecting…
                    </h2>
                    <p style={{ fontSize: '0.875rem', opacity: 0.7, margin: 0 }}>
                        {attempt > 0
                            ? `Attempt ${attempt} — please wait`
                            : 'Trying to reconnect to the server'}
                    </p>
                </>
            )}

            {connectionState === 'failed' && (
                <>
                    <div style={{ fontSize: '3rem', marginBottom: 16 }}>⚠️</div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 8px' }}>
                        Connection Lost
                    </h2>
                    <p style={{ fontSize: '0.875rem', opacity: 0.7, margin: '0 0 20px', textAlign: 'center', maxWidth: 300 }}>
                        Unable to reach the server. Check your internet connection and try again.
                    </p>
                    <button
                        onClick={handleRetry}
                        className="reconnect-retry-btn"
                        style={{
                            padding: '10px 24px',
                            fontSize: '1rem',
                            fontWeight: 600,
                            backgroundColor: '#3B82F6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'background-color 0.2s',
                        }}
                        onMouseOver={(e) => { e.target.style.backgroundColor = '#2563EB'; }}
                        onMouseOut={(e) => { e.target.style.backgroundColor = '#3B82F6'; }}
                    >
                        🔄 Retry Connection
                    </button>
                </>
            )}

            <style>{`
                @keyframes reconnect-spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default ReconnectionOverlay;
