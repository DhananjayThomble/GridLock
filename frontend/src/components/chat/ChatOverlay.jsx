// frontend/src/components/chat/ChatOverlay.jsx
// Container that manages and positions all active chat bubbles (#216)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import ChatBubble from './ChatBubble';

const MAX_BUBBLES_PER_PLAYER = 3;

// Position chat bubbles relative to viewport — one stack per playerIndex
// On mobile, positions collapse to top-left/right and bottom-left/right
const PLAYER_POSITIONS = [
  { top: '80px', left: '8px' },     // player1 — top-left (below ScoreBar)
  { top: '80px', right: '8px' },    // player2 — top-right
  { bottom: '140px', left: '8px' }, // player3 — bottom-left
  { bottom: '140px', right: '8px' },// player4 — bottom-right
];

const ChatOverlay = ({ socket, gameId }) => {
  const [bubbles, setBubbles] = useState([]);
  const idCounter = useRef(0);

  const handleExpire = useCallback((bubbleId) => {
    setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
  }, []);

  useEffect(() => {
    if (!socket || !gameId) return;

    // Reset bubbles for a fresh game (handles rematch / gameId change).
    // This is in the subscription callback (not synchronous in the effect body).
    const currentGameId = gameId;

    const onChatReceived = (data) => {
      const newBubble = {
        ...data,
        id: `chat-${++idCounter.current}`,
        gameId: currentGameId,
      };

      setBubbles((prev) => {
        // Drop stale bubbles from a previous game
        const current = prev.filter((b) => b.gameId === currentGameId);
        // Filter to keep max per player
        const playerBubbles = current.filter((b) => b.playerIndex === data.playerIndex);
        let updated = current;
        if (playerBubbles.length >= MAX_BUBBLES_PER_PLAYER) {
          // Remove oldest bubble for this player
          const oldestId = playerBubbles[0].id;
          updated = current.filter((b) => b.id !== oldestId);
        }
        return [...updated, newBubble];
      });
    };

    socket.on('game_chat_received', onChatReceived);
    return () => {
      socket.off('game_chat_received', onChatReceived);
    };
  }, [socket, gameId]);

  // Filter to only show bubbles for the current game
  const activeBubbles = bubbles.filter((b) => b.gameId === gameId);

  // Group bubbles by playerIndex
  const grouped = {};
  for (const bubble of activeBubbles) {
    const idx = bubble.playerIndex ?? 0;
    if (!grouped[idx]) grouped[idx] = [];
    grouped[idx].push(bubble);
  }

  return (
    <div className="chat-overlay fixed inset-0 pointer-events-none z-30" aria-live="polite">
      {Object.entries(grouped).map(([playerIdx, playerBubbles]) => {
        const pos = PLAYER_POSITIONS[playerIdx] || PLAYER_POSITIONS[0];
        return (
          <div
            key={`chat-stack-${playerIdx}`}
            className="absolute flex flex-col-reverse items-start"
            style={{ ...pos }}
          >
            {playerBubbles.map((bubble) => (
              <ChatBubble key={bubble.id} message={bubble} onExpire={handleExpire} />
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default ChatOverlay;
