// backend/constants/chatConstants.js
// Single source of truth for in-game chat allowlists (#216)
// Frontend copy: frontend/src/components/chat/chatConstants.js (keep in sync)

const ALLOWED_QUICK_MESSAGES = [
    'Good Luck! 🍀', 'GG! 🤝', 'Hello! 👋',
    'Nice Move! 👍', 'Oops! 😬', 'Wow! 😮', 'No Way! 😲',
    'Too Easy 😎', 'Better Luck Next Time!', "You're Trapped! 🕸️",
    'Well Played! 👏', 'Good Game!', 'Close One! 😅',
    'Thinking... 🤔', 'Hurry Up! ⏰', 'One More! 🔄',
];

const ALLOWED_EMOJIS = [
    '😂', '🔥', '💀', '👏', '😱', '🎉', '😤', '🤯',
    '💪', '🏆', '😭', '❤️', '👀', '🤝', '😈',
];

const ALLOWED_CHAT_CONTENT = new Set([...ALLOWED_QUICK_MESSAGES, ...ALLOWED_EMOJIS]);

module.exports = {
    ALLOWED_QUICK_MESSAGES,
    ALLOWED_EMOJIS,
    ALLOWED_CHAT_CONTENT,
};
