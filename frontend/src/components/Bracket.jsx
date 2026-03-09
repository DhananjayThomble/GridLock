// src/components/Bracket.jsx
// Visual single-elimination bracket for 4 or 8 player tournaments

import React from 'react';

function getRoundLabel(roundIndex, totalRounds) {
  if (totalRounds <= 1) return 'Finals';
  if (roundIndex === totalRounds - 1) return 'Finals';
  if (roundIndex === totalRounds - 2) return 'Semifinals';
  return `Round ${roundIndex + 1}`;
}

/** Reusable gray "?" placeholder avatar for empty/TBD slots */
function PlaceholderAvatar() {
  return (
    <span
      className="bg-muted-15 text-base inline-flex items-center justify-center w-6 h-6 rounded-full font-bold"
      style={{
        color: 'var(--text-muted)',
        fontSize: '0.75rem',
      }}
    >?</span>
  );
}

function MatchCard({ match, participants }) {
  const p1Avatar = participants.find((p) => p.username === match.player1)?.avatar;
  const p2Avatar = participants.find((p) => p.username === match.player2)?.avatar;

  const hasWinner = !!match.winner;
  const inProgress = match.gameId && !hasWinner;

  const borderClass = inProgress
    ? 'border-warning-60'
    : hasWinner
    ? 'border-success-40'
    : '';

  const renderPlayer = (name, avatar, isWinner) => {
    if (!name) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <PlaceholderAvatar />
          <span className="italic">TBD</span>
        </div>
      );
    }
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-sm transition-all"
        style={{ color: isWinner ? 'var(--success)' : hasWinner ? 'var(--text-muted)' : 'var(--text-secondary)', fontWeight: isWinner ? 700 : 400 }}
      >
        <span className="text-base">{avatar || <PlaceholderAvatar />}</span>
        <span className="truncate max-w-[100px] sm:max-w-[120px]">{name}</span>
        {isWinner && <span className="ml-auto">🏆</span>}
      </div>
    );
  };

  return (
    <div
      className={`rounded-xl overflow-hidden min-w-[160px] sm:min-w-[180px] transition-all border ${borderClass}`}
      style={{ backgroundColor: 'var(--bg-card)', borderColor: borderClass ? undefined : 'var(--border-color)' }}
    >
      {inProgress && (
        <div className="bg-warning-15 text-xs font-bold text-center py-0.5 motion-safe:animate-pulse" style={{ color: 'var(--warning)' }}>
          🎮 In Progress
        </div>
      )}
      {renderPlayer(match.player1, p1Avatar, match.winner === match.player1)}
      <div style={{ borderTop: '1px solid var(--border-color)' }} />
      {renderPlayer(match.player2, p2Avatar, match.winner === match.player2)}
    </div>
  );
}

const Bracket = ({ rounds = [], participants = [], champion }) => {
  if (!rounds.length) return null;

  return (
    <div className="w-full overflow-x-auto pb-4">
      <div className="flex gap-6 sm:gap-10 min-w-max px-2 items-center">
        {rounds.map((round, roundIndex) => (
          <div key={roundIndex} className="flex flex-col items-center gap-2">
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
              {getRoundLabel(roundIndex, rounds.length)}
            </div>
            <div className="flex flex-col gap-4 justify-center" style={{ minHeight: roundIndex === 0 ? 'auto' : undefined }}>
              {round.matches.map((match, matchIndex) => (
                <div key={matchIndex} className="flex items-center">
                  <MatchCard match={match} participants={participants} />
                  {roundIndex < rounds.length - 1 && (
                    <div className="w-6 sm:w-10 ml-1" style={{ borderTop: '1px solid var(--border-color-strong)' }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Champion column */}
        {champion && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--warning)' }}>
              Champion
            </div>
            <div className="bg-warning-12 border-warning-40 rounded-xl px-6 py-4 text-center border">
              <div className="text-4xl mb-1">
                {participants.find((p) => p.username === champion)?.avatar || '🏆'}
              </div>
              <div className="font-bold text-sm" style={{ color: 'var(--warning)' }}>{champion}</div>
              <div className="text-lg" style={{ color: 'var(--warning)' }}>🏆</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Re-export helpers for potential reuse
Bracket.getRoundLabel = getRoundLabel;

export default Bracket;
