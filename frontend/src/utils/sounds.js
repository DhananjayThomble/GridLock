// sounds.js - Web Audio API sound effects for GridLock
// No external libraries, no audio files — pure oscillator-based sounds

const SETTINGS_KEY = 'gridlock_sound_settings';
const OLD_MUTE_KEY = 'gridlock_muted';

const DEFAULT_SETTINGS = {
  moveSound: true,
  scoreSound: true,
  turnAlert: true,
  vibration: true,
  volume: 80,
  masterMute: false,
};

// Shared AudioContext (lazy init to respect browser autoplay policy)
let audioContext = null;
let isInitialized = false;

// Module-level settings cache to avoid repeated localStorage reads
let _cachedSettings = null;

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
 * Load settings from localStorage, migrating old format if needed
 */
export const getSoundSettings = () => {
  if (_cachedSettings) return _cachedSettings;

  // Migrate old mute key on first load
  const oldMute = localStorage.getItem(OLD_MUTE_KEY);
  if (oldMute !== null) {
    const migrated = { ...DEFAULT_SETTINGS, masterMute: oldMute === 'true' };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
    localStorage.removeItem(OLD_MUTE_KEY);
    _cachedSettings = migrated;
    return migrated;
  }

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const result = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      _cachedSettings = result;
      return result;
    }
  } catch {
    // Corrupted data — reset
  }
  const defaults = { ...DEFAULT_SETTINGS };
  _cachedSettings = defaults;
  return defaults;
};

/**
 * Save settings to localStorage
 */
export const saveSoundSettings = (settings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  _cachedSettings = settings;
};

/**
 * Check if sounds are currently muted (backward compat API)
 */
export const isMuted = () => {
  return getSoundSettings().masterMute;
};

/**
 * Toggle master mute and persist (backward compat API)
 */
export const toggleMute = () => {
  const settings = { ...getSoundSettings() };
  settings.masterMute = !settings.masterMute;
  saveSoundSettings(settings);
  return settings.masterMute;
};

/**
 * Check if vibration is enabled
 */
export const isVibrationEnabled = () => {
  const settings = getSoundSettings();
  return !settings.masterMute && settings.vibration;
};

/**
 * Helper: get effective volume (0-1 range)
 */
const getEffectiveVolume = (baseVolume) => {
  const settings = getSoundSettings();
  return baseVolume * (settings.volume / 100);
};

/**
 * Helper: check if a specific sound category is enabled
 */
const isSoundEnabled = (category) => {
  const settings = getSoundSettings();
  if (settings.masterMute) return false;
  return settings[category] !== false;
};

/**
 * Helper: play a single tone
 */
const playTone = (frequency, duration, startTime = 0, volume = 0.3) => {
  if (!audioContext) return;
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

  const effectiveVol = getEffectiveVolume(volume);
  const now = ctx.currentTime + startTime;
  gain.gain.setValueAtTime(effectiveVol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.start(now);
  osc.stop(now + duration);
};

/**
 * Helper: play multiple tones in sequence
 */
const playSequence = (notes) => {
  if (!audioContext) return;

  let offset = 0;
  notes.forEach(({ freq, duration, volume = 0.3 }) => {
    playTone(freq, duration, offset, volume);
    offset += duration;
  });
};

// ─── Sound Effects ────────────────────────────────────────────────────────────

/**
 * Short click - played when a line is placed on the board
 * ~60ms, subtle tap sound gated by moveSound
 */
export const linePlaced = () => {
  if (!isSoundEnabled('moveSound')) return;
  playTone(600, 0.06, 0, 0.2);
};

/**
 * Short soft click - played when local player captures a tile
 * ~100ms, pleasant high tone
 */
export const tileCaptured = () => {
  if (!isSoundEnabled('scoreSound')) return;
  playTone(800, 0.08, 0, 0.25);
};

/**
 * Subtle alert - played when opponent captures a tile
 * ~150ms, lower tone to differentiate from own capture
 */
export const opponentCapture = () => {
  if (!isSoundEnabled('scoreSound')) return;
  playTone(350, 0.12, 0, 0.2);
};

/**
 * Short fanfare - played when game starts (all players joined)
 * ~400ms, ascending tones
 * Not gated by any individual toggle — always plays unless master muted
 */
export const gameStart = () => {
  const settings = getSoundSettings();
  if (settings.masterMute) return;
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
  if (!isSoundEnabled('scoreSound')) return;
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
  if (!isSoundEnabled('scoreSound')) return;
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
  if (!isSoundEnabled('turnAlert')) return;
  playSequence([
    { freq: 660, duration: 0.08, volume: 0.25 }, // E5
    { freq: 880, duration: 0.12, volume: 0.3 },  // A5
  ]);
};

// Export all sounds as a single object for convenience
export const sounds = {
  linePlaced,
  tileCaptured,
  opponentCapture,
  gameStart,
  gameWin,
  gameLose,
  turnNotify,
};

export default sounds;
