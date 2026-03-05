// src/components/Bracket.jsx
// Visual single-elimination bracket for 4 or 8 player tournaments

import React from 'react';

function getRoundLabel(roundIndex, totalRounds) {
  if (totalRounds <= 1) return 'Finals';
  if (roundIndex === totalRounds - 1) return 'Finals';
  if (roundIndex === totalRounds - 2) return 'Semifinals';
  return `Round ${roundIndex + 1}`;
}

function MatchCard({ match, participants }) {
  const p1Avatar = participants.find((p) => p.username === match.player1)?.avatar || '❓';
  const p2Avatar = participants.find((p) => p.username === match.player2)?.avatar || '❓';

  const hasWinner = !!match.winner;
  const inProgress = match.gameId && !hasWinner;

  let borderClass = 'border-white/10';
  if (inProgress) borderClass = 'border-yellow-500/60';
  else if (hasWinner) borderClass = 'border-green-500/40';

  const renderPlayer = (name, avatar, isWinner) => {
    if (!name) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-white/30 text-sm">
          <span className="text-base">❓</span>
          <span className="italic">TBD</span>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 px-3 py-2 text-sm transition-all ${
        isWinner ? 'text-green-300 font-bold' : hasWinner ? 'text-white/40' : 'text-white/80'
      }`}>
        <span className="text-base">{avatar}</span>
        <span className="truncate max-w-[100px] sm:max-w-[120px]">{name}</span>
        {isWinner && <span className="ml-auto">🏆</span>}
      </div>
    );
  };

  return (
    <div className={`bg-white/5 rounded-xl border ${borderClass} overflow-hidden min-w-[160px] sm:min-w-[180px] transition-all`}>
      {inProgress && (
        <div className="bg-yellow-500/20 text-yellow-300 text-xs font-bold text-center py-0.5 animate-pulse">
          🎮 In Progress
        </div>
      )}
      {renderPlayer(match.player1, p1Avatar, match.winner === match.player1)}
      <div className="border-t border-white/10" />
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
            <div className="text-xs font-bold text-blue-300 uppercase tracking-wider mb-2">
              {getRoundLabel(roundIndex, rounds.length)}
            </div>
            <div className="flex flex-col gap-4 justify-center" style={{ minHeight: roundIndex === 0 ? 'auto' : undefined }}>
              {round.matches.map((match, matchIndex) => (
                <div key={matchIndex} className="flex items-center">
                  <MatchCard match={match} participants={participants} />
                  {roundIndex < rounds.length - 1 && (
                    <div className="w-6 sm:w-10 border-t border-white/20 ml-1" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Champion column */}
        {champion && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-2">
              Champion
            </div>
            <div className="bg-gradient-to-br from-yellow-500/20 to-amber-600/20 rounded-xl border border-yellow-500/40 px-6 py-4 text-center">
              <div className="text-4xl mb-1">
                {participants.find((p) => p.username === champion)?.avatar || '🏆'}
              </div>
              <div className="text-yellow-300 font-bold text-sm">{champion}</div>
              <div className="text-yellow-500 text-lg">🏆</div>
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
