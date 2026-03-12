// frontend/src/components/chat/ChatButton.jsx
// Floating chat button for in-game quick chat (#216)

import React, { useState, useEffect } from 'react';

const ChatButton = ({ onClick, disabled, cooldown }) => {
  const [pulse, setPulse] = useState(true);

  // Remove pulse animation after first few seconds
  useEffect(() => {
    const timer = setTimeout(() => setPulse(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="chat-button chat-button-position fixed z-40 flex items-center justify-center rounded-full shadow-lg transition-all duration-200 active:scale-90"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: cooldown ? 'var(--bg-surface)' : 'var(--accent)',
        color: cooldown ? 'var(--text-muted)' : 'var(--text-on-accent)',
        border: '2px solid var(--border-color)',
        opacity: cooldown ? 0.6 : 1,
        cursor: cooldown ? 'not-allowed' : 'pointer',
        animation: pulse && !cooldown ? 'chat-btn-pulse 2s ease-in-out 2' : 'none',
      }}
      aria-label="Open quick chat"
      title={cooldown ? 'Chat on cooldown' : 'Quick chat'}
    >
      <span className="text-xl leading-none">💬</span>
    </button>
  );
};

export default ChatButton;
