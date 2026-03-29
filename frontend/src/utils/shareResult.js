// shareResult.js — Generate Wordle-style shareable game results

const PLAYER_EMOJI = {
  player1: '🟦',
  player2: '🟥',
  player3: '🟩',
  player4: '🟨',
};

const UNCLAIMED = '⬛';

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

  // Build player IDs
  const playerIds = Array.from({ length: count }, (_, i) => `player${i + 1}`);

  // Determine outcome keyword and emoji
  let outcomeWord;
  let outcomeEmoji;
  if (winner === 'draw') {
    outcomeWord = 'Draw';
    outcomeEmoji = '🤝';
  } else if (winner === role) {
    outcomeWord = 'Won';
    outcomeEmoji = '🏆';
  } else {
    outcomeWord = 'Lost';
    outcomeEmoji = '💔';
  }

  // Build grid
  const grid = gameState.boxes
    .map(row =>
      row.map(cell => PLAYER_EMOJI[cell] || UNCLAIMED).join('')
    )
    .join('\n');

  // Build score line from all player scores in player order
  const scoreList = playerIds.map(pid => scores[pid] || 0);
  const scoreLine = `Score: ${scoreList.join('-')} · ${outcomeWord}! ${outcomeEmoji}`;

  // Assemble
  const lines = [];

  lines.push(`🔲 GridLock ${size}×${size} · ${count}P`);

  if (options.tournamentRound) {
    lines.push('🏆 Tournament');
  }

  lines.push(grid);
  lines.push(scoreLine);
  lines.push('Play: gridlock.pro');

  return lines.join('\n');
}

/**
 * Copy text to clipboard (primary) and optionally trigger native share on mobile.
 * @param {string} text - Text to share
 * @returns {Promise<'copied'|'shared'>}
 */
export async function shareOrCopy(text) {
  // Clipboard first (primary action — always attempt)
  let clipboardOk = false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      clipboardOk = true;
    } catch {
      // Clipboard failed — continue to native share
    }
  }

  // Try native share as secondary action (mobile)
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch {
      // User cancelled or share failed
      if (clipboardOk) return 'copied';
    }
  }

  if (clipboardOk) return 'copied';

  throw new Error('Sharing not supported');
}
