// frontend/src/components/chat/ChatPanel.jsx
// Slide-up panel with preset messages and emoji tabs (#216)

import React, { useState, useEffect, useRef } from 'react';
import { QUICK_MESSAGES, EMOJIS } from './chatConstants';

const ChatPanel = ({ onSend, onClose, allowChat = true, allowEmoji = true }) => {
  const [tab, setTab] = useState(allowChat ? 'chat' : 'emoji');
  const [draft, setDraft] = useState('');
  const panelRef = useRef(null);

  // Focus the panel when it opens
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.focus();
    }
  }, []);

  const handleSend = (content) => {
    onSend(content);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
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
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Quick chat panel"
        onKeyDown={handleKeyDown}
        className="chat-panel fixed bottom-0 left-0 right-0 z-50 mx-auto rounded-t-2xl shadow-2xl outline-none"
        style={{
          maxWidth: '400px', maxHeight: '80dvh', overflowY: 'auto', paddingBottom: 'env(safe-area-inset-bottom)',
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
          {allowChat && <button
            onClick={() => setTab('chat')}
            className="chat-panel-tab flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: tab === 'chat' ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === 'chat' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}
          >
            💬 Chat
          </button>}
          {allowEmoji && <button
            onClick={() => setTab('emoji')}
            className="chat-panel-tab flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors"
            style={{
              backgroundColor: tab === 'emoji' ? 'var(--accent)' : 'var(--bg-surface)',
              color: tab === 'emoji' ? 'var(--text-on-accent)' : 'var(--text-secondary)',
            }}
          >
            😀 Emoji
          </button>}
        </div>

        {tab === 'chat' && <form className="flex gap-2 px-3 pb-2" onSubmit={e => {
          e.preventDefault();
          if (draft.trim()) onSend(draft.trim(), 'text');
        }}>
          <input className="min-w-0 flex-1 rounded-lg border px-2 text-base" aria-label="Message" placeholder="Message the room" value={draft} maxLength={50} onChange={e => setDraft(e.target.value)} />
          <button className="min-h-11 px-3 font-semibold" disabled={!draft.trim()}>Send</button>
        </form>}
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
