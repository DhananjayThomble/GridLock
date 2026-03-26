// src/components/lobby/AvatarGrid.jsx
// Shared avatar selection grid used in both mobile and desktop Lobby layouts.
import React from 'react';

const AVATARS = ['👦','👧','🧑','👩','🤖','🐱','🐶','🦊','🐻','🐼','🦁','🐯','🚀','⚽','🎮','🦄'];

const AvatarGrid = ({ selectedAvatar, onSelect, onSelectAndCollapse }) => (
  <div className="grid grid-cols-8 gap-1.5 sm:gap-2" role="radiogroup" aria-label="Pick avatar">
    {AVATARS.map((av) => (
      <button
        key={av}
        onClick={() => (onSelectAndCollapse ? onSelectAndCollapse(av) : onSelect(av))}
        role="radio"
        aria-checked={selectedAvatar === av}
        aria-label={`Avatar ${av}`}
        className={`rounded-lg text-xl sm:text-2xl flex items-center justify-center transition-all active:scale-90 lobby-avatar-btn ${
          selectedAvatar === av
            ? 'ring-2 ring-offset-2 scale-110 shadow-lg'
            : ''
        }`}
        style={{
          minWidth: '48px',
          minHeight: '48px',
          ...(selectedAvatar === av
            ? { background: 'var(--accent)', '--tw-ring-color': 'var(--accent-hover)', '--tw-ring-offset-color': 'var(--bg-secondary)' }
            : { background: 'var(--bg-card-hover)' }),
        }}
      >
        {av}
      </button>
    ))}
  </div>
);

export { AVATARS };
export default AvatarGrid;
