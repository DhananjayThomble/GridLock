// src/components/__tests__/Board.test.jsx
import React, { act } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mock matchMedia
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});

// Mock all heavy dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({
      state: {
        username: 'TestUser',
        role: 'player1',
        gameId: 'ABC123',
        gridSize: 3,
        avatar: '👦',
        playerCount: 2,
        sessionToken: 'test-token',
      },
    }),
  };
});

const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
vi.mock('../../socket', () => ({
  default: {
    on: (...a) => mockOn(...a),
    off: (...a) => mockOff(...a),
    emit: (...a) => mockEmit(...a),
    connected: true,
    id: 'sock-1',
    io: { on: vi.fn(), off: vi.fn() },
  },
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('../../utils/sessionStats', () => ({ recordGame: vi.fn(), getStats: () => ({}) }));
vi.mock('../../utils/recentOpponentsStore', () => ({ recordOpponent: vi.fn() }));
vi.mock('../../utils/sounds', () => ({
  initAudio: vi.fn(), toggleMute: vi.fn(), isMuted: () => false, isVibrationEnabled: () => false, sounds: { linePlaced: vi.fn() },
}));
vi.mock('../../utils/shareResult', () => ({ generateShareText: vi.fn(), shareOrCopy: vi.fn() }));
vi.mock('../../hooks/useThemeColors', () => ({ default: () => ({}) }));
vi.mock('../PostGameStatsCard', () => ({ default: () => null }));
vi.mock('../chat/ChatButton', () => ({ default: () => null }));
vi.mock('../chat/ChatPanel', () => ({ default: () => null }));
vi.mock('../chat/ChatOverlay', () => ({ default: () => null }));
vi.mock('../chat/chatConstants', () => ({ RATE_LIMIT_MS: 3000 }));
vi.mock('../../utils/safeStorage', () => ({
  safeStorage: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() },
}));
vi.mock('../../utils/postGameUtils', () => ({ countLines: vi.fn(() => 0) }));
vi.mock('../../lib/posthog', () => ({ capture: vi.fn() }));
vi.mock('../../lib/sentry', () => ({ addBreadcrumb: vi.fn(), setTag: vi.fn(), setUser: vi.fn() }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../contexts/GridThemeContext', () => ({
  useGridTheme: () => ({
    theme: {
      id: 'clean', dotColor: '#808892', emptyLineColor: '#6a7280',
      lineThickness: 6, visualDotSize: 5, dotStyle: { borderRadius: '50%' },
      lineStyle: { borderRadius: '3px' },
      players: { p1: { lineColor: '#6366f1', boxBg: 'rgba(99,102,241,0.12)' }, p2: { lineColor: '#f59e0b', boxBg: 'rgba(245,158,11,0.12)' } },
    },
    checkAndUnlockThemes: vi.fn(),
  }),
}));
vi.mock('../../themes/gridThemes', () => ({
  playerKeyFromRole: (id) => id === 'player1' ? 'p1' : 'p2',
  GRID_THEMES: [],
}));
vi.mock('../../hooks/useGridSizes', () => ({
  default: () => ({ dot: 12, visualDot: 10, line: 40, gap: 0 }),
}));
vi.mock('../../utils/onboarding', () => ({ markPlayed: vi.fn() }));
vi.mock('../../utils/tabSync', () => ({ initTabSync: vi.fn(), cleanup: vi.fn() }));
vi.mock('../ScoreBar', () => ({
  default: ({ players }) => (
    <div data-testid="mock-scorebar">
      {players?.map((p) => <span key={p.id}>{p.username}</span>)}
    </div>
  ),
}));

const { default: Board } = await import('../Board');

const renderBoard = () => render(
  <MemoryRouter>
    <Board />
  </MemoryRouter>
);

describe('Board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits join_game on mount', () => {
    renderBoard();
    expect(mockEmit).toHaveBeenCalledWith('join_game', expect.objectContaining({
      gameId: 'ABC123',
      username: 'TestUser',
      avatar: '👦',
      sessionToken: 'test-token',
      joinMode: 'player',
    }));
  });

  it('registers essential socket event listeners', () => {
    renderBoard();
    const registeredEvents = mockOn.mock.calls.map((c) => c[0]);
    expect(registeredEvents).toContain('game_update');
    expect(registeredEvents).toContain('error');
  });

  it('cleans up socket listeners on unmount', () => {
    const { unmount } = renderBoard();
    unmount();
    const cleanedEvents = mockOff.mock.calls.map((c) => c[0]);
    expect(cleanedEvents).toContain('game_update');
    expect(cleanedEvents).toContain('error');
  });

  it('shows connecting status initially', () => {
    renderBoard();
    expect(screen.getByText(/Connecting|Waiting/)).toBeInTheDocument();
  });

  it('renders board grid when game_update arrives', () => {
    renderBoard();
    const gameUpdateHandler = mockOn.mock.calls.find((c) => c[0] === 'game_update')?.[1];
    if (gameUpdateHandler) {
      const fakeData = {
        gameState: {
          gridSize: 3,
          horizontalLines: Array(4).fill(null).map(() => Array(3).fill(null)),
          verticalLines: Array(3).fill(null).map(() => Array(4).fill(null)),
          boxes: Array(3).fill(null).map(() => Array(3).fill(null)),
          scores: { player1: 0, player2: 0 },
          currentPlayer: 'player1',
          gameOver: false,
          players: [
            { id: 'player1', username: 'TestUser', avatar: '👦', color: '#6366f1' },
            { id: 'player2', username: 'Opponent', avatar: '👧', color: '#f59e0b' },
          ],
          playerCount: 2,
        },
      };
      act(() => gameUpdateHandler(fakeData));
      const dots = screen.getAllByTestId('board-dot');
      expect(dots.length).toBe(16);
    }
  });

  it('shows error message on socket error event', () => {
    renderBoard();
    const errorHandler = mockOn.mock.calls.find((c) => c[0] === 'error')?.[1];
    if (errorHandler) {
      act(() => errorHandler({ message: 'Game not found' }));
      expect(screen.getByText(/Game not found/)).toBeInTheDocument();
    }
  });

  // ── Tap assist (#590: G-01 / G-02) ─────────────────────────────────────────
  describe('tap assist', () => {
    const makeState = (over = {}) => ({
      gridSize: 3,
      horizontalLines: Array(4).fill(null).map(() => Array(3).fill(null)),
      verticalLines: Array(3).fill(null).map(() => Array(4).fill(null)),
      boxes: Array(3).fill(null).map(() => Array(3).fill(null)),
      scores: { player1: 0, player2: 0 },
      currentPlayer: 'player1',
      gameOver: false,
      players: [
        { id: 'player1', username: 'TestUser', avatar: '👦', color: '#6366f1' },
        { id: 'player2', username: 'Opponent', avatar: '👧', color: '#f59e0b' },
      ],
      playerCount: 2,
      ...over,
    });

    const load = (state) => {
      renderBoard();
      const handler = mockOn.mock.calls.find((c) => c[0] === 'game_update')?.[1];
      act(() => handler({ gameState: state }));
    };

    // jsdom has no layout, so give every line a fixed rectangle: 40px long, 12px thick, 50px pitch
    let realRect;
    beforeAll(() => {
      realRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        const t = this.dataset?.line;
        if (!t) return realRect.call(this);
        const r = Number(this.dataset.r); const c = Number(this.dataset.c);
        const [left, top, width, height] = t === 'horizontal'
          ? [c * 50 + 12, r * 50, 40, 12]
          : [c * 50, r * 50 + 12, 12, 40];
        return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} };
      };
    });
    afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });

    const moves = () => mockEmit.mock.calls.filter((c) => c[0] === 'make_move');

    it('snaps a tap just beside a line to that line', () => {
      load(makeState());
      fireEvent.click(screen.getByTestId('board-container'), { clientX: 32, clientY: 17 });
      expect(moves()).toHaveLength(1);
      expect(moves()[0][1]).toMatchObject({ type: 'horizontal', r: 0, c: 0, playerId: 'player1' });
    });

    it('ignores a tap in the middle of a box (moves cannot be undone)', () => {
      load(makeState());
      fireEvent.click(screen.getByTestId('board-container'), { clientX: 32, clientY: 32 });
      expect(moves()).toHaveLength(0);
    });

    it('never emits a move for a line that is already taken', () => {
      const state = makeState();
      state.horizontalLines[0][0] = 'player2';
      load(state);
      fireEvent.click(screen.getAllByTestId('board-hline')[0]);
      expect(moves()).toHaveLength(0);
    });

    it('does not select a taken line when snapping from the gap beside it', () => {
      const state = makeState();
      state.horizontalLines[0][0] = 'player2';
      load(state);
      fireEvent.click(screen.getByTestId('board-container'), { clientX: 32, clientY: 17 });
      expect(moves()).toHaveLength(0);
    });

    it('ignores taps when it is not my turn', () => {
      load(makeState({ currentPlayer: 'player2' }));
      fireEvent.click(screen.getByTestId('board-container'), { clientX: 32, clientY: 17 });
      expect(moves()).toHaveLength(0);
    });

    it('shows server errors as an overlay so the board does not move', () => {
      load(makeState());
      const errorHandler = mockOn.mock.calls.find((c) => c[0] === 'error')?.[1];
      act(() => errorHandler('Line already taken'));
      const banner = screen.getByTestId('game-error');
      expect(banner).toHaveTextContent('Line already taken');
      expect(banner.className).toMatch(/\babsolute\b/);
    });
  });
});
