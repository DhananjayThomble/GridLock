// sounds.js - Web Audio API sound effects for GridLock
// No external libraries, no audio files — pure oscillator-based sounds

const STORAGE_KEY = 'gridlock_muted';

// Shared AudioContext (lazy init to respect browser autoplay policy)
let audioContext = null;
let isInitialized = false;

/**
 * Initialize AudioContext on first user interaction
 * Must be called from a user-triggered event (click, keypress, etc.)
 */
export const initAudio = () => {
  if (!isInitialized) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      isInitialized = true;
    } catch (err) {
      console.warn('Web Audio API not supported:', err);
      return;
    }
  }
  // Resume suspended context (mobile browsers suspend until user gesture)
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
};

/**
 * Check if sounds are currently muted
 */
export const isMuted = () => {
  return localStorage.getItem(STORAGE_KEY) === 'true';
};

/**
 * Toggle mute state and persist to localStorage
 */
export const toggleMute = () => {
  const currentlyMuted = isMuted();
  localStorage.setItem(STORAGE_KEY, (!currentlyMuted).toString());
  return !currentlyMuted;
};

/**
 * Helper: play a single tone
 */
const playTone = (frequency, duration, startTime = 0, volume = 0.3) => {
  if (!audioContext || isMuted()) return;
  // Ensure context is running (may be suspended on mobile)
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  const ctx = audioContext;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.frequency.value = frequency;
  osc.type = 'sine';

  const now = ctx.currentTime + startTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.start(now);
  osc.stop(now + duration);
};

/**
 * Helper: play multiple tones in sequence
 */
const playSequence = (notes) => {
  if (!audioContext || isMuted()) return;

  let offset = 0;
  notes.forEach(({ freq, duration, volume = 0.3 }) => {
    playTone(freq, duration, offset, volume);
    offset += duration;
  });
};

// ─── Sound Effects ────────────────────────────────────────────────────────────

/**
 * Short soft click - played when local player captures a tile
 * ~100ms, pleasant high tone
 */
export const tileCaptured = () => {
  playTone(800, 0.08, 0, 0.25);
};

/**
 * Subtle alert - played when opponent captures a tile
 * ~150ms, lower tone to differentiate from own capture
 */
export const opponentCapture = () => {
  playTone(350, 0.12, 0, 0.2);
};

/**
 * Short fanfare - played when game starts (all players joined)
 * ~400ms, ascending tones
 */
export const gameStart = () => {
  playSequence([
    { freq: 523, duration: 0.1, volume: 0.25 }, // C5
    { freq: 659, duration: 0.1, volume: 0.25 }, // E5
    { freq: 784, duration: 0.15, volume: 0.3 }, // G5
  ]);
};

/**
 * Celebration sound - played when player wins
 * ~800ms, happy ascending tones with flourish
 */
export const gameWin = () => {
  playSequence([
    { freq: 523, duration: 0.15, volume: 0.3 },  // C5
    { freq: 659, duration: 0.15, volume: 0.3 },  // E5
    { freq: 784, duration: 0.15, volume: 0.35 }, // G5
    { freq: 1047, duration: 0.25, volume: 0.35 }, // C6
  ]);
};

/**
 * Loss sound - played when player loses
 * ~500ms, descending tones
 */
export const gameLose = () => {
  playSequence([
    { freq: 440, duration: 0.15, volume: 0.25 }, // A4
    { freq: 392, duration: 0.15, volume: 0.25 }, // G4
    { freq: 349, duration: 0.2, volume: 0.25 },  // F4
  ]);
};

/**
 * Turn notification - played when it becomes the player's turn
 * ~200ms, bright two-note ping
 */
export const turnNotify = () => {
  playSequence([
    { freq: 660, duration: 0.08, volume: 0.25 }, // E5
    { freq: 880, duration: 0.12, volume: 0.3 },  // A5
  ]);
};

// Export all sounds as a single object for convenience
export const sounds = {
  tileCaptured,
  opponentCapture,
  gameStart,
  gameWin,
  gameLose,
  turnNotify,
};

export default sounds;
