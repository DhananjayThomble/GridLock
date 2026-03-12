// frontend/src/components/chat/ChatPanel.jsx
// Slide-up panel with preset messages and emoji tabs (#216)

import React, { useState } from 'react';
import { QUICK_MESSAGES, EMOJIS } from './chatConstants';

const ChatPanel = ({ onSend, onClose }) => {
  const [tab, setTab] = useState('chat');

  const handleSend = (content) => {
    onSend(content);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="chat-panel fixed bottom-0 left-0 right-0 z-50 mx-auto rounded-t-2xl shadow-2xl"
        style={{
          maxWidth: '400px',
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderBottom: 'none',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          animation: 'chat-panel-slide-up 0.25s ease-out',
        }}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-2 pb-1">
          <div
            className="w-10 h-1 rounded-full"
            style={{ backgroundColor: 'var(--text-muted)', opacity: 0.4 }}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 pb-2">
          <button
            onClick={() => setTab('chat')}
            className="flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: tab === 'chat' ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === 'chat' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}
          >
            💬 Chat
          </button>
          <button
            onClick={() => setTab('emoji')}
            className="flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: tab === 'emoji' ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === 'emoji' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}
          >
            😀 Emoji
          </button>
        </div>

        {/* Content */}
        <div className="px-3 pb-4 overflow-y-auto" style={{ maxHeight: '280px' }}>
          {tab === 'chat' ? (
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_MESSAGES.map((msg) => (
                <button
                  key={msg.value}
                  onClick={() => handleSend(msg.value)}
                  className="chat-msg-btn px-2 py-2.5 rounded-xl text-xs font-medium transition-all active:scale-95 text-left"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)',
                    minHeight: '44px',
                  }}
                >
                  {msg.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleSend(emoji)}
                  className="chat-emoji-btn flex items-center justify-center rounded-xl text-2xl transition-all active:scale-90"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    minHeight: '48px',
                    minWidth: '48px',
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ChatPanel;
