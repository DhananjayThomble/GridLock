// frontend/src/components/chat/ChatBubble.jsx
// Floating chat bubble that appears near a player's avatar (#216)

import React, { useEffect, useState, useRef } from 'react';

const PLAYER_COLORS = [
  'var(--player1-color)',
  'var(--player2-color)',
  'var(--player3-color)',
  'var(--player4-color)',
];

const ChatBubble = ({ message, onExpire }) => {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  // Ref to avoid stale closure if parent re-creates onExpire without useCallback
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    // Trigger enter animation
    const enterTimer = requestAnimationFrame(() => setVisible(true));

    // Start exit after 3s
    const exitTimer = setTimeout(() => setExiting(true), 3000);

    // Remove after exit animation
    const removeTimer = setTimeout(() => {
      if (onExpireRef.current) onExpireRef.current(message.id);
    }, 3500);

    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [message.id]);

  const isEmoji = message.type === 'emoji';
  const playerColor = PLAYER_COLORS[message.playerIndex] || PLAYER_COLORS[0];

  return (
    <div
      className="chat-bubble pointer-events-none"
      style={{
        opacity: exiting ? 0 : visible ? 1 : 0,
        transform: exiting ? 'scale(0.8) translateY(-8px)' : visible ? 'scale(1)' : 'scale(0.8)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        padding: isEmoji ? '4px 8px' : '6px 12px',
        borderRadius: '12px',
        backgroundColor: 'var(--bg-card)',
        border: `1.5px solid ${playerColor}`,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        maxWidth: isEmoji ? '56px' : '180px',
        textAlign: 'center',
        marginBottom: '4px',
      }}
    >
      {isEmoji ? (
        <span style={{ fontSize: '28px', lineHeight: 1 }}>{message.content}</span>
      ) : (
        <>
          <div
            className="text-xs font-bold truncate mb-0.5"
            style={{ color: playerColor, maxWidth: '140px' }}
          >
            {message.username}
          </div>
          <div
            className="text-xs font-medium"
            style={{ color: 'var(--text-primary)', lineHeight: 1.3 }}
          >
            {message.content}
          </div>
        </>
      )}
    </div>
  );
};

export default ChatBubble;
