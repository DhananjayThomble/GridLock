// frontend/src/components/chat/chatConstants.js
// Quick chat & emoji constants for in-game chat (#216)

export const QUICK_MESSAGES = [
  // Greetings
  { label: 'Hello! 👋', value: 'Hello! 👋' },
  { label: 'Good Luck! 🍀', value: 'Good Luck! 🍀' },
  { label: 'GG! 🤝', value: 'GG! 🤝' },
  // Reactions
  { label: 'Nice Move! 👍', value: 'Nice Move! 👍' },
  { label: 'Well Played! 👏', value: 'Well Played! 👏' },
  { label: 'Wow! 😮', value: 'Wow! 😮' },
  // Taunts
  { label: 'Oops! 😬', value: 'Oops! 😬' },
  { label: 'No Way! 😲', value: 'No Way! 😲' },
  { label: 'Too Easy 😎', value: 'Too Easy 😎' },
  { label: "You're Trapped! 🕸️", value: "You're Trapped! 🕸️" },
  // End game
  { label: 'Good Game!', value: 'Good Game!' },
  { label: 'Better Luck Next Time!', value: 'Better Luck Next Time!' },
  { label: 'Close One! 😅', value: 'Close One! 😅' },
  // Misc
  { label: 'Thinking... 🤔', value: 'Thinking... 🤔' },
  { label: 'Hurry Up! ⏰', value: 'Hurry Up! ⏰' },
  { label: 'One More! 🔄', value: 'One More! 🔄' },
];

export const EMOJIS = [
  '😂', '🔥', '💀', '👏', '😱', '🎉', '😤', '🤯',
  '💪', '🏆', '😭', '❤️', '👀', '🤝', '😈',
];

export const RATE_LIMIT_MS = 2000;
