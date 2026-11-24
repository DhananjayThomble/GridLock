const PLAY_URL = 'https://gridlock.pro/';

/** Format a completed match without exposing player names or room IDs. */
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

  return [
    `${outcome} in GridLock! ${size}×${size} · ${mode}`,
    `Score: ${score} boxes`,
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
