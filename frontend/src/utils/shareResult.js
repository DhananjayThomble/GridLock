// shareResult.js — Generate Wordle-style shareable game results

const PLAYER_EMOJI = {
  player1: '🟦',
  player2: '🟥',
  player3: '🟩',
  player4: '🟨',
};

const UNCLAIMED = '⬜';

/**
 * Generate a shareable text representation of the game result.
 * @param {Object} gameState - The final game state (boxes, scores, winner, playerCount, etc.)
 * @param {number} gridSize - Grid size (2-6)
 * @param {number} playerCount - Number of players (2-4)
 * @param {string} role - Current player's role (e.g., 'player1')
 * @param {Object} [options] - Optional: { tournamentRound, isCPU }
 * @returns {string} Shareable text
 */
export function generateShareText(gameState, gridSize, playerCount, role, options = {}) {
  if (!gameState || !gameState.boxes) return '';

  const scores = gameState.scores || {};
  const winner = gameState.winner;
  const count = playerCount || gameState.playerCount || 2;
  const size = gridSize || 3;

  // Build player IDs and their scores sorted by score descending
  const playerIds = Array.from({ length: count }, (_, i) => `player${i + 1}`);
  const myScore = scores[role] || 0;

  // Determine outcome text
  let outcomeText;
  if (winner === 'draw') {
    // For 2-player draw: "Drew 8-8"; multi: "Drew 3-3-3"
    const scoreList = playerIds.map(pid => scores[pid] || 0);
    outcomeText = `Drew ${scoreList.join('-')}`;
  } else if (winner === role) {
    // Sort other players' scores for display
    const otherScores = playerIds
      .filter(pid => pid !== role)
      .map(pid => scores[pid] || 0)
      .sort((a, b) => b - a);
    outcomeText = `Won ${myScore}-${otherScores.join('-')}`;
  } else {
    // Loss — show winner's score first, then others
    const winnerScore = scores[winner] || 0;
    const otherScores = playerIds
      .filter(pid => pid !== role && pid !== winner)
      .map(pid => scores[pid] || 0)
      .sort((a, b) => b - a);
    outcomeText = `Lost ${myScore}-${winnerScore}${otherScores.length ? '-' + otherScores.join('-') : ''}`;
  }

  // Build grid
  const grid = gameState.boxes
    .map(row =>
      row.map(cell => PLAYER_EMOJI[cell] || UNCLAIMED).join('')
    )
    .join('\n');

  // Assemble
  const lines = [];

  lines.push(`🔷 GridLock | ${outcomeText} | ${size}×${size}`);

  if (options.tournamentRound) {
    lines.push('🏆 Tournament');
  }

  lines.push(grid);
  lines.push('gridlock.snapurl.in');

  return lines.join('\n');
}

/**
 * Copy text to clipboard and optionally trigger native share on mobile.
 * @param {string} text - Text to share
 * @returns {Promise<'copied'|'shared'>}
 */
export async function shareOrCopy(text) {
  // Try native share first (mobile)
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }

  // Clipboard fallback
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }

  throw new Error('Sharing not supported');
}
