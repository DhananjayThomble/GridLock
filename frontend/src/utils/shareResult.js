const PLAY_URL = 'https://gridlock.pro/';

export const DAILY_PLAY_URL = PLAY_URL + 'daily/';

/** Format scores and public links without including seat credentials. */
export function generateShareText(gameState, gridSize, playerCount, role, options = {}) {
  if (!gameState?.winner) return '';

  const { winner, scores = {}, hasCPU } = gameState;
  const count = playerCount || gameState.playerCount || 2;
  const size = gridSize || 3;
  const playerIds = Array.from({ length: count }, (_, i) => `player${i + 1}`);
  const scoreOrder = playerIds.includes(role) ? [role, ...playerIds.filter((id) => id !== role)] : playerIds;
  const score = scoreOrder.map((id) => scores[id] ?? 0).join('–');
  const outcome = winner === 'draw' ? 'Draw' : winner === role ? 'I won' : 'I lost';
  const mode = options.tournamentRound ? 'Tournament' : hasCPU ? 'vs CPU' : `${count} players`;

  const replay = options.replayUrl ? ['Watch the game: ' + options.replayUrl] : [];
  if (options.dailyChallenge) {
    return [`I scored ${scores[role] ?? 0}/${size * size} boxes in GridLock Daily!\nCan you beat my score today? ${DAILY_PLAY_URL}`, ...replay].join('\n');
  }

  return [
    `${outcome} in GridLock! ${size}×${size} · ${mode}`,
    `Score: ${score} boxes`,
    ...(count > 2 ? [scoreOrder.map(id => (id === role ? 'Me' : 'Player ' + id.slice(6)) + ' ' + (scores[id] ?? 0)).join(' · ')] : []),
    ...replay,
    `Play Dots & Boxes: ${PLAY_URL}`,
  ].join('\n');
}

/** Open native sharing when available, with clipboard as the fallback. */
export async function shareOrCopy(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return null;
    }
  }

  if (!navigator.clipboard?.writeText) throw new Error('Sharing is unavailable');
  await navigator.clipboard.writeText(text);
  return 'copied';
}
