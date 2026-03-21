import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useThemeColors from '../hooks/useThemeColors';
import { captureException } from '../lib/sentry';

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

const formatDuration = (seconds) => {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const formatTimeAgo = (value) => {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// ── ELO Chart (pure SVG) ────────────────────────────────────────────────────
const EloChart = ({ history }) => {
  const themeColors = useThemeColors();

  if (!history || history.length < 2) {
    return <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Not enough data for chart</p>;
  }

  const width = 600, height = 200, pad = 40;
  const elos = history.map((h) => h.elo);
  const minElo = Math.min(...elos) - 20;
  const maxElo = Math.max(...elos) + 20;
  const range = maxElo - minElo || 1;

  const coords = history.map((h, i) => {
    const x = pad + (i / (history.length - 1)) * (width - 2 * pad);
    const y = pad + (1 - (h.elo - minElo) / range) * (height - 2 * pad);
    return { x, y };
  });

  const points = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const trending = elos[elos.length - 1] >= elos[0];
  const color = trending
    ? (themeColors['--success'] || '#3fb950')
    : (themeColors['--danger'] || '#f85149');

  // Gradient fill area
  const areaPath = `M ${coords[0].x},${height - pad} ` +
    coords.map((c) => `L ${c.x},${c.y}`).join(' ') +
    ` L ${coords[coords.length - 1].x},${height - pad} Z`;

  const last = coords[coords.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = pad + pct * (height - 2 * pad);
          const label = Math.round(maxElo - pct * range);
          return (
            <g key={pct}>
              <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="var(--border-color)" />
              <text x={pad - 5} y={y + 4} textAnchor="end" fill="var(--text-muted)" fontSize="10">{label}</text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#eloGrad)" />

        {/* Line */}
        <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={points} />

        {/* Current value dot */}
        <circle cx={last.x} cy={last.y} r="4" fill={color} />
      </svg>
      <div className="flex justify-between text-xs mt-1 px-1" style={{ color: 'var(--text-muted)' }}>
        <span>Min: {Math.min(...elos)}</span>
        <span>Current: {elos[elos.length - 1]}</span>
        <span>Max: {Math.max(...elos)}</span>
      </div>
    </div>
  );
};

// ── Match Row ────────────────────────────────────────────────────────────────
const MatchRow = ({ match, onPlayerClick }) => {
  const eloChange = (match.eloAfter || 0) - (match.eloBefore || 0);
  const resultColors = { win: 'var(--success)', loss: 'var(--danger)', draw: 'var(--warning)' };
  const resultLabels = { win: 'W', loss: 'L', draw: 'D' };

  return (
    <div className="flex items-center gap-3 py-2.5 last:border-0" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <span className="font-bold text-sm w-6 text-center" style={{ color: resultColors[match.result] }}>
        {resultLabels[match.result]}
      </span>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          className="text-sm cursor-pointer hover:underline bg-transparent border-none p-0"
          style={{ color: 'var(--text-primary)' }}
          onClick={() => onPlayerClick?.(match.opponents?.[0])}
        >
          vs {match.opponents?.join(', ') || 'Unknown'}
        </button>
        <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
          {match.gridSize}×{match.gridSize} · {match.playerCount}P
        </span>
      </div>
      <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
        {match.scores?.player}-{match.scores?.opponent}
      </span>
      <span className="text-xs font-bold" style={{ color: eloChange >= 0 ? 'var(--success)' : 'var(--danger)' }}>
        {eloChange >= 0 ? '+' : ''}{eloChange}
      </span>
      <span className="text-xs hidden sm:inline" style={{ color: 'var(--text-subtle)' }}>{formatTimeAgo(match.playedAt)}</span>
    </div>
  );
};

// ── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub }) => (
  <div className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
    <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</p>
    <p className="text-xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
    {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
  </div>
);

// ── Main Profile Component ───────────────────────────────────────────────────
const Profile = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    const fetchProfile = async () => {
      try {
        const res = await fetch(apiUrl(`/api/profile/${encodeURIComponent(username)}`));
        const data = await res.json();
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'Failed to load profile');
        }
        if (!cancelled) setProfile(data.profile);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load profile');
        captureException(err, { tags: { source: 'profile.fetch' } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchProfile();
    return () => { cancelled = true; };
  }, [username]);

  const handlePlayerClick = (name) => {
    if (name) navigate(`/profile/${encodeURIComponent(name)}`);
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
      >
        <div className="text-lg animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading profile…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
      >
        <p className="text-lg" style={{ color: 'var(--danger)' }}>{error}</p>
        <Link to="/leaderboard" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>← Back to Leaderboard</Link>
      </div>
    );
  }

  if (!profile) return null;

  const p = profile;

  return (
    <div
      className="min-h-screen p-4 sm:p-6"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Back link */}
        <Link to="/leaderboard" className="text-sm inline-flex items-center gap-1 transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
          ← Leaderboard
        </Link>

        {/* Header */}
        <div className="text-center">
          <div className="text-5xl mb-2" aria-hidden="true">{p.avatar || '👤'}</div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{p.username}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Rank #{p.rank} · Member since {formatDate(p.memberSince)}
          </p>
          {p.lastPlayedAt && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>Last played {formatTimeAgo(p.lastPlayedAt)}</p>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Games" value={p.gamesPlayed} />
          <StatCard label="Wins" value={p.wins} sub={`${p.losses}L · ${p.draws}D`} />
          <StatCard label="Win Rate" value={`${p.winRate}%`} />
          <StatCard label="ELO" value={p.elo} />
          <StatCard
            label="Streak"
            value={p.currentStreak > 0 ? `${p.currentStreak}🔥` : '0'}
          />
          <StatCard label="Best Streak" value={p.bestStreak} />
        </div>

        {/* Computed Stats */}
        {(p.computed?.favoriteGridSize || p.computed?.avgDuration || p.computed?.mostPlayedOpponent) && (
          <div className="grid grid-cols-3 gap-3">
            {p.computed.favoriteGridSize && (
              <StatCard label="Fav Grid" value={`${p.computed.favoriteGridSize}×${p.computed.favoriteGridSize}`} />
            )}
            {p.computed.avgDuration && (
              <StatCard label="Avg Duration" value={formatDuration(p.computed.avgDuration)} />
            )}
            {p.computed.mostPlayedOpponent && (
              <StatCard
                label="Rival"
                value={
                  <button
                    type="button"
                    className="cursor-pointer hover:underline bg-transparent border-none p-0 text-xl font-bold"
                    style={{ color: 'var(--text-primary)' }}
                    onClick={() => handlePlayerClick(p.computed.mostPlayedOpponent)}
                  >
                    {p.computed.mostPlayedOpponent}
                  </button>
                }
              />
            )}
          </div>
        )}

        {/* ELO History Chart */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="font-bold mb-3" style={{ color: 'var(--text-primary)' }}>📈 ELO History</h2>
          <EloChart history={p.eloHistory} />
        </div>

        {/* Recent Matches */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <h2 className="font-bold mb-3" style={{ color: 'var(--text-primary)' }}>🎮 Recent Matches</h2>
          {p.recentMatches && p.recentMatches.length > 0 ? (
            <div>
              {p.recentMatches.map((match, i) => (
                <MatchRow key={match._id || i} match={match} onPlayerClick={handlePlayerClick} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>
              {p.gamesPlayed > 0 ? 'Match history is not available for older games' : 'No matches played yet'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;
