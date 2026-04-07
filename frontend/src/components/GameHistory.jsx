// src/components/GameHistory.jsx
// Browse past games with ELO changes, filters, and stats summary

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { captureException } from '../lib/sentry';
import { safeStorage } from '../utils/safeStorage';

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

const apiUrl = (path) => `${API_BASE}${path}`;

const ITEMS_PER_PAGE = 20;

const RESULT_LABELS = { win: 'Win', loss: 'Loss', draw: 'Draw' };
const RESULT_ICONS = { win: '🏆', loss: '💔', draw: '🤝' };

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const formatEloDelta = (delta) => {
  if (delta == null) return '—';
  if (delta > 0) return `+${delta}`;
  return String(delta);
};

/** Safely parse a JSON response, returning { error } on non-JSON replies (#5) */
const parseApiResponse = async (res) => {
  try {
    return await res.json();
  } catch {
    return { success: false, error: 'Server returned an unexpected response' };
  }
};

const GameHistory = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [history, setHistory] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalCount: 0 });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [resultFilter, setResultFilter] = useState('');
  const [playerCountFilter, setPlayerCountFilter] = useState('');
  const [gridSizeFilter, setGridSizeFilter] = useState('');

  const abortRef = useRef(null);
  // Track whether initial URL params have been applied (#10)
  const initializedRef = useRef(false);
  // Capture initial page from URL — consumed on first fetch, then null
  const initialPageRef = useRef(null);

  // Read initial state from URL params on mount (#4, #10)
  useEffect(() => {
    const player = searchParams.get('player');
    const result = searchParams.get('result') || '';
    const playerCount = searchParams.get('playerCount') || '';
    const gridSize = searchParams.get('gridSize') || '';
    const pageParam = parseInt(searchParams.get('page'), 10);

    if (result) setResultFilter(result);
    if (playerCount) setPlayerCountFilter(playerCount);
    if (gridSize) setGridSizeFilter(gridSize);
    initialPageRef.current = pageParam > 0 ? pageParam : null;

    if (player) {
      setUsername(player);
      setUsernameInput(player);
    } else {
      // Auto-load recent games for the current user (#518)
      const savedUsername = safeStorage.getItem('gridlock_username');
      if (savedUsername && savedUsername.trim()) {
        setUsername(savedUsername.trim());
        setUsernameInput(savedUsername.trim());
      }
    }

    initializedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount to read initial URL params
  }, []);

  /** Sync all active filters + page to URL search params (#4) */
  const syncUrlParams = useCallback((player, page, filters) => {
    const params = {};
    if (player) params.player = player;
    if (page > 1) params.page = String(page);
    if (filters.result) params.result = filters.result;
    if (filters.playerCount) params.playerCount = filters.playerCount;
    if (filters.gridSize) params.gridSize = filters.gridSize;
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const fetchHistory = useCallback(async (player, page = 1, filters = {}, options = {}) => {
    if (!player) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({
        player,
        page: String(page),
        limit: String(ITEMS_PER_PAGE),
      });
      if (filters.result) params.set('result', filters.result);
      if (filters.playerCount) params.set('playerCount', filters.playerCount);
      if (filters.gridSize) params.set('gridSize', filters.gridSize);
      // Skip stats on page > 1 — use cached stats from page 1 (#2)
      if (options.skipStats) params.set('skipStats', 'true');

      const res = await fetch(apiUrl(`/api/games/history?${params}`), {
        signal: controller.signal,
      });

      const data = await parseApiResponse(res);

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch game history');
      }

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch game history');
      }

      if (!controller.signal.aborted) {
        setHistory(data.history || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, totalCount: 0 });
        // Only update stats when the server sent them (page 1)
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) {
        captureException(err, { tags: { source: 'gameHistory.fetch' } });
        setError(err?.message || 'Failed to fetch game history');
        setHistory([]);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch when username or filters change (always resets to page 1)
  useEffect(() => {
    if (!initializedRef.current) return;
    if (username) {
      const filters = {
        result: resultFilter,
        playerCount: playerCountFilter,
        gridSize: gridSizeFilter,
      };
      const startPage = initialPageRef.current || 1;
      initialPageRef.current = null; // consume — subsequent filter changes reset to page 1
      fetchHistory(username, startPage, filters, { skipStats: startPage > 1 });
      syncUrlParams(username, startPage, filters);
    }
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncUrlParams is stable via useCallback; we intentionally trigger on filter/username changes only
  }, [username, resultFilter, playerCountFilter, gridSizeFilter, fetchHistory]);

  const handleSearch = (e) => {
    e.preventDefault();
    const trimmed = usernameInput.trim();
    if (trimmed) {
      setUsername(trimmed);
      // URL will be synced by the useEffect above
    }
  };

  const goToPage = (page) => {
    const filters = {
      result: resultFilter,
      playerCount: playerCountFilter,
      gridSize: gridSizeFilter,
    };
    // Skip stats for page > 1 — frontend uses cached stats (#2)
    fetchHistory(username, page, filters, { skipStats: page > 1 });
    syncUrlParams(username, page, filters);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getResultStyle = (result) => {
    switch (result) {
      case 'win':
        return { color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 12%, transparent)' };
      case 'loss':
        return { color: 'var(--danger)', bg: 'color-mix(in srgb, var(--danger) 12%, transparent)' };
      case 'draw':
        return { color: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 12%, transparent)' };
      default:
        return { color: 'var(--text-secondary)', bg: 'transparent' };
    }
  };

  return (
    <div
      className="min-h-screen px-3 py-5 sm:px-6 sm:py-8"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="mx-auto w-full max-w-5xl">
        {/* Header */}
        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-4xl font-extrabold sm:text-5xl" style={{ color: 'var(--text-primary)' }}>
            📜 Game History
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--label-color)' }}>
            Browse your past games with ELO changes
          </p>
        </header>

        {/* Search */}
        <section
          className="mb-4 rounded-2xl p-4 backdrop-blur-md sm:p-5"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
            Look up player
          </h2>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleSearch}>
            <input
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              placeholder="Enter username"
              className="w-full rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
              aria-label="Player username"
            />
            <button
              type="submit"
              className="rounded-xl px-4 py-2.5 font-semibold transition disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--text-on-accent)' }}
              disabled={loading || !usernameInput.trim()}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 rounded-full animate-spin inline-block" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                  Loading…
                </span>
              ) : 'Search'}
            </button>
          </form>
        </section>

        {/* Stats Summary — uses optional chaining for null safety (#9) */}
        {stats && !error && (
          <section
            className="mb-4 rounded-2xl p-4 backdrop-blur-md sm:p-5"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
            aria-label="Game statistics summary"
          >
            <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
              Stats Overview
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
                <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.totalGames}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Total Games</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 25%, transparent)' }}>
                <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.winRate}%</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Win Rate</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)' }}>
                <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{stats.avgDuration != null ? formatDuration(stats.avgDuration) : '—'}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Avg Duration</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)' }}>
                <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {stats?.currentStreak?.count > 0
                    ? `${stats.currentStreak.count} ${stats.currentStreak.type === 'win' ? '🔥' : stats.currentStreak.type === 'loss' ? '❄️' : '🤝'}`
                    : '—'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Current Streak</p>
              </div>
            </div>
          </section>
        )}

        {/* Filters */}
        {username && (
          <section
            className="mb-4 rounded-2xl p-4 backdrop-blur-md sm:p-5"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
            aria-label="Filter games"
          >
            <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>
              Filters
            </h2>
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Result
                <select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
                  aria-label="Filter by result"
                >
                  <option value="">All</option>
                  <option value="win">Wins</option>
                  <option value="loss">Losses</option>
                  <option value="draw">Draws</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Players
                <select
                  value={playerCountFilter}
                  onChange={(e) => setPlayerCountFilter(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
                  aria-label="Filter by player count"
                >
                  <option value="">All</option>
                  <option value="2">2 Players</option>
                  <option value="3">3 Players</option>
                  <option value="4">4 Players</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Grid Size
                <select
                  value={gridSizeFilter}
                  onChange={(e) => setGridSizeFilter(e.target.value)}
                  className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
                  aria-label="Filter by grid size"
                >
                  <option value="">All</option>
                  {[3, 4, 5, 6].map((s) => (
                    <option key={s} value={String(s)}>{s}×{s}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        {/* Loading — spinner for consistency with Board/TournamentLobby (#11) */}
        {loading && (
          <div
            className="rounded-2xl p-8 text-center flex flex-col items-center gap-3"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
            role="status"
            aria-label="Loading game history"
          >
            <span className="w-8 h-8 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
            Loading game history…
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div
            className="rounded-2xl p-6"
            style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Empty state — no username (#12: role="status") */}
        {!loading && !error && !username && (
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
            role="status"
          >
            Enter a username above to view game history.
          </div>
        )}

        {/* Empty state — no games (#12: role="status") */}
        {!loading && !error && username && history.length === 0 && (
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}
            role="status"
          >
            No games found{resultFilter || playerCountFilter || gridSizeFilter ? ' with these filters' : ''}. Play some games to see history here!
          </div>
        )}

        {/* Game cards */}
        {!loading && !error && history.length > 0 && (
          <>
            <section aria-label="Game history list">
              <div className="grid gap-3 sm:grid-cols-2">
                {history.map((game) => {
                  const resultStyle = getResultStyle(game.result);
                  return (
                    <Link
                      key={game.gameId}
                      to={`/replay/${game.gameId}`}
                      className="block rounded-2xl p-4 transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      style={{
                        background: 'var(--bg-card-hover)',
                        border: '1px solid var(--border-color-strong)',
                        textDecoration: 'none',
                        color: 'var(--text-primary)',
                      }}
                      aria-label={`Game on ${formatDate(game.playedAt)} — ${RESULT_LABELS[game.result] || game.result} against ${game.opponents.join(', ') || 'unknown'}`}
                    >
                      {/* Top row: result badge + date */}
                      <div className="flex items-center justify-between mb-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
                          style={{ backgroundColor: resultStyle.bg, color: resultStyle.color }}
                        >
                          {RESULT_ICONS[game.result]} {RESULT_LABELS[game.result] || game.result}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(game.playedAt)}
                        </span>
                      </div>

                      {/* Opponents */}
                      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                        vs {game.opponents.length > 0 ? game.opponents.join(', ') : '—'}
                      </p>

                      {/* Game details */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <span>{game.gridSize}×{game.gridSize}</span>
                        <span>{game.playerCount}P</span>
                        <span>Score: {game.scores.player}–{game.scores.opponent}</span>
                        {game.duration != null && <span>{formatDuration(game.duration)}</span>}
                      </div>

                      {/* ELO delta */}
                      {game.eloDelta != null && (
                        <div className="mt-2 text-sm font-bold" style={{ color: game.eloDelta > 0 ? 'var(--success)' : game.eloDelta < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                          ELO {formatEloDelta(game.eloDelta)}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <nav
                className="mt-4 flex items-center justify-center gap-2"
                aria-label="Game history pagination"
              >
                <button
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-40"
                  style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
                  aria-label="Previous page"
                >
                  ← Prev
                </button>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-40"
                  style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
                  aria-label="Next page"
                >
                  Next →
                </button>
              </nav>
            )}

            <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-muted)' }}>
              Showing {history.length} of {pagination.totalCount} games
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default GameHistory;
