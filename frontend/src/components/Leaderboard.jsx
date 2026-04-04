import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import RankBadge from './RankBadge';
import { captureException } from '../lib/sentry';

const DEFAULT_LIMIT = 20;
const API_BASE = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_SOCKET_URL ||
  ''
).replace(/\/$/, '');

const apiUrl = (path) => `${API_BASE}${path}`;

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
};

const parseApiResponse = async (res) => {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  try {
    await res.text();
  } catch {
    // ignore body read failures and fall back to generic errors
  }
  return null;
};

const Leaderboard = () => {
  const [activeTab, setActiveTab] = useState('casual'); // 'casual' | 'ranked'
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rankedRows, setRankedRows] = useState([]);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedError, setRankedError] = useState('');

  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState('');

  const lookupAbortRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const loadLeaderboard = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(apiUrl(`/api/leaderboard?limit=${DEFAULT_LIMIT}`));
        const data = await parseApiResponse(res);

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Unable to load leaderboard');
        }

        if (!cancelled) {
          setRows(Array.isArray(data.leaderboard) ? data.leaderboard : []);
        }
      } catch (err) {
        if (!cancelled) {
          captureException(err, { tags: { source: 'leaderboard.casual' } });
          setError(err?.message || 'Unable to load leaderboard');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadLeaderboard();

    return () => {
      cancelled = true;
      if (lookupAbortRef.current) lookupAbortRef.current.abort();
    };
  }, []);

  // ── Ranked leaderboard fetch ──────────────────────────────────────────────
  // Re-fetches every time user switches to ranked tab (Fix #11)
  useEffect(() => {
    if (activeTab !== 'ranked') return;

    let cancelled = false;

    const loadRankedLeaderboard = async () => {
      setRankedLoading(true);
      setRankedError('');
      try {
        const res = await fetch(apiUrl(`/api/ranked/leaderboard?limit=${DEFAULT_LIMIT}`));
        const data = await parseApiResponse(res);

        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Unable to load ranked leaderboard');
        }

        if (!cancelled) {
          setRankedRows(Array.isArray(data.leaderboard) ? data.leaderboard : []);
        }
      } catch (err) {
        if (!cancelled) {
          captureException(err, { tags: { source: 'leaderboard.ranked' } });
          setRankedError(err?.message || 'Unable to load ranked leaderboard');
          setRankedRows([]);
        }
      } finally {
        if (!cancelled) setRankedLoading(false);
      }
    };

    loadRankedLeaderboard();
    return () => { cancelled = true; };
  }, [activeTab]);

  const topThree = useMemo(() => rows.slice(0, 3), [rows]);
  const rankedTopThree = useMemo(() => rankedRows.slice(0, 3), [rankedRows]);

  /* On mobile (<768px), skip ranks 1-3 in table when top-3 cards are shown */
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const tableRows = useMemo(
    () => (isMobile && rows.length >= 3 ? rows.slice(3) : rows),
    [rows, isMobile],
  );

  const onLookup = async (event) => {
    event.preventDefault();
    const username = query.trim();

    if (!username) {
      setPlayer(null);
      setPlayerError('Enter a username to search');
      return;
    }

    if (lookupAbortRef.current) lookupAbortRef.current.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;

    setPlayerLoading(true);
    setPlayerError('');
    setPlayer(null);

    try {
      const res = await fetch(apiUrl(`/api/leaderboard/${encodeURIComponent(username)}`), {
        signal: controller.signal,
      });
      const data = await parseApiResponse(res);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Unable to find player');
      }

      if (!controller.signal.aborted) {
        setPlayer(data.player || null);
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && !controller.signal.aborted) {
        captureException(err, { tags: { source: 'leaderboard.playerSearch' } });
        setPlayerError(err?.message || 'Unable to find player');
      }
    } finally {
      if (!controller.signal.aborted) {
        setPlayerLoading(false);
      }
    }
  };

  return (
    <div
      className="min-h-screen px-3 py-5 sm:px-6 sm:py-8"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-4xl font-extrabold sm:text-5xl" style={{ color: 'var(--text-primary)' }}>🏆 Leaderboard</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--label-color)' }}>Top GridLock players by wins, win rate, then ELO</p>

          {/* Tab Switcher */}
          <div className="flex justify-center gap-2 mt-4">
            {[
              { key: 'casual', label: '🎮 Casual' },
              { key: 'ranked', label: '⚔️ Ranked' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="px-5 py-2 rounded-xl text-sm font-semibold transition-all"
                style={activeTab === key
                  ? { background: 'var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 4px 12px color-mix(in srgb, var(--accent) 30%, transparent)', minHeight: '44px' }
                  : { background: 'var(--bg-card)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)', minHeight: '44px' }}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <section
          className="mb-4 rounded-2xl p-4 backdrop-blur-md sm:p-5"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >
          <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Find a player</h2>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onLookup}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search username"
              className="w-full rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--border-color-strong)', color: 'var(--text-primary)' }}
              aria-label="Search username"
            />
            <button
              type="submit"
              className="rounded-xl px-4 py-2.5 font-semibold transition disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--text-on-accent)' }}
              disabled={playerLoading}
            >
              {playerLoading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {playerError && <p className="mt-2 text-left text-sm" style={{ color: 'var(--danger)' }}>{playerError}</p>}

          {player && (
            <div className="mt-3 rounded-xl p-3 text-left text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', color: 'var(--text-primary)' }}>
              <p className="font-bold">
                <Link to={`/profile/${encodeURIComponent(player.username)}`} className="hover:underline">
                  #{player.rank} {player.username}
                </Link>
              </p>
              <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                {player.wins}W · {player.losses}L · {player.draws}D · {player.winRate}% WR · ELO {player.elo}
              </p>
            </div>
          )}
        </section>

        {/* ── Casual Leaderboard ── */}
        {activeTab === 'casual' && (
          <>
            {loading && (
              <div className="card-surface rounded-2xl p-8" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}>Loading leaderboard…</div>
            )}

            {!loading && error && (
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
                Could not load leaderboard: {error}
              </div>
            )}

            {!loading && !error && rows.length === 0 && (
              <div className="card-surface rounded-2xl p-6" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}>
                No leaderboard data yet. Play some games to claim the top spot.
              </div>
            )}

            {!loading && !error && rows.length > 0 && (
              <>
                <section className="mb-4 grid gap-3 sm:grid-cols-3">
                  {topThree.map((entry) => (
                    <article key={entry.username} className="rounded-2xl p-4 text-left" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--text-primary)' }}>
                      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--warning)' }}>Rank #{entry.rank}</p>
                      <h3 className="mt-1 text-lg font-bold flex items-center gap-1.5">
                        {entry.avatar && <span className="text-xl" aria-hidden="true">{entry.avatar}</span>}
                        <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline transition-colors" style={{ color: 'var(--text-primary)' }}>
                          {entry.username}
                        </Link>
                      </h3>
                      <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>ELO {entry.elo} · {entry.winRate}% WR</p>
                    </article>
                  ))}
                </section>

                {/* Mobile card layout (#344) */}
                <section className="leaderboard-mobile-cards">
                  {tableRows.map((entry) => (
                    <div key={entry.username} className="leaderboard-mobile-card">
                      <span className="leaderboard-mobile-card-rank">#{entry.rank}</span>
                      <div className="leaderboard-mobile-card-info">
                        <div className="leaderboard-mobile-card-name">
                          {entry.avatar && <span aria-hidden="true">{entry.avatar} </span>}
                          <Link to={`/profile/${encodeURIComponent(entry.username)}`}>{entry.username}</Link>
                        </div>
                        <div className="leaderboard-mobile-card-stats">
                          <span>{entry.wins}W / {entry.losses}L / {entry.draws}D</span>
                          <span>·</span>
                          <span>{entry.winRate}% WR</span>
                        </div>
                      </div>
                      <span className="leaderboard-mobile-card-elo">{entry.elo}</span>
                    </div>
                  ))}
                </section>

                {/* Desktop table */}
                <section className="card-surface leaderboard-desktop-table overflow-hidden rounded-2xl backdrop-blur-md" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}>
                  <div className="leaderboard-scroll-wrapper">
                    <table className="min-w-full text-left text-sm" style={{ color: 'var(--text-primary)' }}>
                      <thead style={{ background: 'var(--bg-card-hover)' }}>
                        <tr>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Rank</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Player</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>W/L/D</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Win Rate</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>ELO</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider leaderboard-last-played" style={{ color: 'var(--label-color)' }}>Last Played</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((entry) => (
                          <tr key={entry.username} style={{ borderTop: '1px solid var(--border-color)' }}>
                            <td className="px-3 py-3 font-semibold">#{entry.rank}</td>
                            <td className="px-3 py-3">
                              <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline transition-colors inline-flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                                {entry.avatar && <span className="text-base" aria-hidden="true">{entry.avatar}</span>}
                                {entry.username}
                              </Link>
                            </td>
                            <td className="px-3 py-3">{entry.wins}/{entry.losses}/{entry.draws}</td>
                            <td className="px-3 py-3">{entry.winRate}%</td>
                            <td className="px-3 py-3">{entry.elo}</td>
                            <td className="px-3 py-3 leaderboard-last-played">{formatDate(entry.lastPlayedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <p className="text-xs mt-3 text-center" style={{color: 'var(--text-muted)'}}>Ranked by ELO. Ties broken by total games played.</p>
              </>
            )}
          </>
        )}

        {/* ── Ranked Leaderboard ── */}
        {activeTab === 'ranked' && (
          <>
            {rankedLoading && (
              <div className="card-surface rounded-2xl p-8" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}>Loading ranked leaderboard…</div>
            )}

            {!rankedLoading && rankedError && (
              <div className="rounded-2xl p-6" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
                Could not load ranked leaderboard: {rankedError}
              </div>
            )}

            {!rankedLoading && !rankedError && rankedRows.length === 0 && (
              <div className="card-surface rounded-2xl p-6" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)', color: 'var(--text-secondary)' }}>
                No ranked players yet. Play ranked matches to climb the ladder!
              </div>
            )}

            {!rankedLoading && !rankedError && rankedRows.length > 0 && (
              <>
                <section className="mb-4 grid gap-3 sm:grid-cols-3">
                  {rankedTopThree.map((entry) => (
                    <article key={entry.username} className="rounded-2xl p-4 text-left" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)', color: 'var(--text-primary)' }}>
                      <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--warning)' }}>Rank #{entry.rank}</p>
                      <h3 className="mt-1 text-lg font-bold flex items-center gap-1.5">
                        <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline transition-colors" style={{ color: 'var(--text-primary)' }}>
                          {entry.username}
                        </Link>
                      </h3>
                      <div className="mt-1">
                        <RankBadge tier={entry.tier} tierIcon={entry.tierIcon} elo={entry.elo} size="sm" showElo />
                      </div>
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {entry.wins}W / {entry.losses}L · {entry.winRate}% WR
                        {entry.isInPlacement && <span style={{ color: 'var(--accent)' }}> · Placing</span>}
                      </p>
                    </article>
                  ))}
                </section>

                {/* Mobile card layout (#344) */}
                <section className="leaderboard-mobile-cards">
                  {rankedRows.map((entry) => (
                    <div key={entry.username} className="leaderboard-mobile-card">
                      <span className="leaderboard-mobile-card-rank">#{entry.rank}</span>
                      <div className="leaderboard-mobile-card-info">
                        <div className="leaderboard-mobile-card-name">
                          <Link to={`/profile/${encodeURIComponent(entry.username)}`}>{entry.username}</Link>
                        </div>
                        <div className="leaderboard-mobile-card-stats">
                          <RankBadge tier={entry.tier} tierIcon={entry.tierIcon} size="sm" />
                          <span>{entry.wins}W / {entry.losses}L</span>
                          <span>·</span>
                          <span>{entry.winRate}% WR</span>
                          {entry.isInPlacement && <span style={{ color: 'var(--accent)' }}>· Placing</span>}
                        </div>
                      </div>
                      <span className="leaderboard-mobile-card-elo">{entry.elo}</span>
                    </div>
                  ))}
                </section>

                {/* Desktop table */}
                <section className="card-surface leaderboard-desktop-table overflow-hidden rounded-2xl backdrop-blur-md" style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}>
                  <div className="leaderboard-scroll-wrapper">
                    <table className="min-w-full text-left text-sm" style={{ color: 'var(--text-primary)' }}>
                      <thead style={{ background: 'var(--bg-card-hover)' }}>
                        <tr>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Rank</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Player</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Tier</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>W/L</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>Win Rate</th>
                          <th className="px-3 py-3 text-xs uppercase tracking-wider" style={{ color: 'var(--label-color)' }}>ELO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rankedRows.map((entry) => (
                          <tr key={entry.username} style={{ borderTop: '1px solid var(--border-color)' }}>
                            <td className="px-3 py-3 font-semibold">#{entry.rank}</td>
                            <td className="px-3 py-3">
                              <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline transition-colors" style={{ color: 'var(--accent)' }}>
                                {entry.username}
                              </Link>
                            </td>
                            <td className="px-3 py-3">
                              <RankBadge tier={entry.tier} tierIcon={entry.tierIcon} size="sm" />
                            </td>
                            <td className="px-3 py-3">{entry.wins}/{entry.losses}</td>
                            <td className="px-3 py-3">{entry.winRate}%</td>
                            <td className="px-3 py-3 font-semibold">{entry.elo}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <p className="text-xs mt-3 text-center" style={{color: 'var(--text-muted)'}}>Ranked by ELO · Season resets every 30 days</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
