// src/components/lobby/NameInput.jsx
// Shared name input field used in both mobile and desktop Lobby layouts.
import React from 'react';

const NameInput = ({ inputRef, username, usernameError, onChange, onKeyDown, placeholder = 'Enter your name…' }) => (
  <div>
    <label htmlFor="lobby-name-input" className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--label-color)' }}>Your Name</label>
    <input
      id="lobby-name-input"
      ref={inputRef}
      type="text"
      value={username}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      minLength={2}
      maxLength={16}
      pattern="[a-zA-Z0-9_\-]+"
      autoComplete="nickname"
      autoCorrect="off"
      autoCapitalize="words"
      spellCheck={false}
      inputMode="text"
      enterKeyHint="done"
      className="w-full rounded-xl px-4 py-3 text-base placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition"
      style={{
        background: 'var(--input-bg)',
        border: usernameError ? '1px solid var(--danger)' : '1px solid var(--border-color-strong)',
        color: 'var(--text-primary)',
      }}
    />
    <div className="flex justify-between mt-1">
      {usernameError ? (
        <p className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>⚠️ {usernameError}</p>
      ) : !username.trim() ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Enter a name to start playing</p>
      ) : <span />}
      <p className="text-xs" style={{ color: username.length >= 14 ? 'var(--warning)' : 'var(--text-muted)' }}>
        {username.length}/16
      </p>
    </div>
  </div>
);

export default NameInput;
