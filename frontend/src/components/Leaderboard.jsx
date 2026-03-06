import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const topThree = useMemo(() => rows.slice(0, 3), [rows]);

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
        setPlayerError(err?.message || 'Unable to find player');
      }
    } finally {
      if (!controller.signal.aborted) {
        setPlayerLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 px-3 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 text-center sm:mb-8">
          <h1 className="text-4xl font-extrabold text-white sm:text-5xl">🏆 Leaderboard</h1>
          <p className="mt-2 text-sm text-blue-200">Top GridLock players by wins, win rate, then ELO</p>
        </header>

        <section className="mb-4 rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur-md sm:p-5">
          <h2 className="mb-3 text-left text-sm font-bold uppercase tracking-wider text-blue-200">Find a player</h2>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onLookup}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search username"
              className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-400"
              aria-label="Search username"
            />
            <button
              type="submit"
              className="rounded-xl bg-blue-500 px-4 py-2.5 font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
              disabled={playerLoading}
            >
              {playerLoading ? 'Searching…' : 'Search'}
            </button>
          </form>

          {playerError && <p className="mt-2 text-left text-sm text-red-300">{playerError}</p>}

          {player && (
            <div className="mt-3 rounded-xl border border-blue-300/30 bg-blue-500/10 p-3 text-left text-sm text-white">
              <p className="font-bold">
                <Link to={`/profile/${encodeURIComponent(player.username)}`} className="hover:underline">
                  #{player.rank} {player.username}
                </Link>
              </p>
              <p className="mt-1 text-white/80">
                {player.wins}W · {player.losses}L · {player.draws}D · {player.winRate}% WR · ELO {player.elo}
              </p>
            </div>
          )}
        </section>

        {loading && (
          <div className="rounded-2xl border border-white/20 bg-white/10 p-8 text-white/80">Loading leaderboard…</div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-6 text-red-200">
            Could not load leaderboard: {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="rounded-2xl border border-white/20 bg-white/10 p-6 text-white/70">
            No leaderboard data yet. Play some games to claim the top spot.
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <section className="mb-4 grid gap-3 sm:grid-cols-3">
              {topThree.map((entry) => (
                <article key={entry.username} className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-4 text-left text-white">
                  <p className="text-xs uppercase tracking-wider text-amber-200">Rank #{entry.rank}</p>
                  <h3 className="mt-1 text-lg font-bold">
                    <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline hover:text-amber-200 transition-colors">
                      {entry.username}
                    </Link>
                  </h3>
                  <p className="mt-2 text-sm text-white/80">ELO {entry.elo} · {entry.winRate}% WR</p>
                </article>
              ))}
            </section>

            <section className="overflow-hidden rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm text-white">
                  <thead className="bg-white/10 text-xs uppercase tracking-wider text-blue-200">
                    <tr>
                      <th className="px-3 py-3">Rank</th>
                      <th className="px-3 py-3">Player</th>
                      <th className="px-3 py-3">W/L/D</th>
                      <th className="px-3 py-3">Win Rate</th>
                      <th className="px-3 py-3">ELO</th>
                      <th className="px-3 py-3">Last Played</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr key={entry.username} className="border-t border-white/10">
                        <td className="px-3 py-3 font-semibold">#{entry.rank}</td>
                        <td className="px-3 py-3">
                          <Link to={`/profile/${encodeURIComponent(entry.username)}`} className="hover:underline hover:text-blue-300 transition-colors">
                            {entry.username}
                          </Link>
                        </td>
                        <td className="px-3 py-3">{entry.wins}/{entry.losses}/{entry.draws}</td>
                        <td className="px-3 py-3">{entry.winRate}%</td>
                        <td className="px-3 py-3">{entry.elo}</td>
                        <td className="px-3 py-3">{formatDate(entry.lastPlayedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default Leaderboard;
