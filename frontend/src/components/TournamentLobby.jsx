// src/components/TournamentLobby.jsx
// Tournament lobby — waiting room, bracket display, real-time updates

import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import socket from '../socket';
import Bracket from './Bracket';
import { capture } from '../lib/posthog';
import { addBreadcrumb } from '../lib/sentry';

const TournamentLobby = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tournamentId: initialTournamentId, username, avatar } = location.state || {};

  const [tournament, setTournament] = useState(location.state?.tournament || null);
  const [showCopied, setShowCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [winner, setWinner] = useState(null);
  const [socketError, setSocketError] = useState('');
  const [bracketOverflows, setBracketOverflows] = useState(false);
  const bracketRef = useRef(null);
  const navigatedRef = useRef(false);

  const tournamentId = tournament?.tournamentId || initialTournamentId;

  // Track whether we're re-requesting tournament data (to suppress expected errors)
  const reRequestingRef = useRef(false);

  // ── Socket events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId) {
      navigate('/');
      return;
    }

    const onTournamentUpdate = ({ tournament: t }) => {
      setTournament(t);
      setSocketError('');
      addBreadcrumb({ category: 'tournament', message: 'Tournament update', level: 'info', data: { status: t?.status, tournamentId: t?.tournamentId } });
    };

    const onTournamentGameAssigned = ({ tournamentId: tid, gameId, playerId, sessionToken, gridSize: assignedGridSize, playerCount: assignedPlayerCount }) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      capture('tournament_joined', { tournamentId: tid || tournamentId });
      addBreadcrumb({ category: 'tournament', message: 'Tournament game assigned', level: 'info', data: { tournamentId: tid, gameId } });
      navigate('/game', {
        state: {
          username,
          gameId,
          role: playerId,
          avatar,
          playerCount: assignedPlayerCount || 2,
          gridSize: assignedGridSize,
          sessionToken,
          tournamentId: tid || tournamentId,
        },
      });
    };

    const onTournamentCompleted = ({ champion }) => {
      setWinner(champion);
      setCompleted(true);
      addBreadcrumb({ category: 'tournament', message: 'Tournament completed', level: 'info', data: { champion, tournamentId } });
    };

    const onError = (msg) => {
      if (reRequestingRef.current) {
        reRequestingRef.current = false;
        return;
      }
      setSocketError(typeof msg === 'string' ? msg : 'Something went wrong');
    };

    socket.on('tournament_update', onTournamentUpdate);
    socket.on('tournament_game_assigned', onTournamentGameAssigned);
    socket.on('tournament_completed', onTournamentCompleted);
    socket.on('tournament_joined', onTournamentUpdate);
    socket.on('error', onError);

    // Issue #214: Query current tournament state on mount to catch missed
    // game assignments. If the tournament started before this component
    // mounted its listeners, the server will re-emit the assignment.
    socket.emit('get_tournament_state', { tournamentId });

    return () => {
      socket.off('tournament_update', onTournamentUpdate);
      socket.off('tournament_game_assigned', onTournamentGameAssigned);
      socket.off('tournament_completed', onTournamentCompleted);
      socket.off('tournament_joined', onTournamentUpdate);
      socket.off('error', onError);
    };
  }, [tournamentId, username, avatar, navigate]);

  useEffect(() => {
    navigatedRef.current = false;
  }, [tournamentId]);

  // Detect bracket overflow to conditionally show scroll affordance
  useEffect(() => {
    const wrapper = bracketRef.current;
    if (!wrapper) return;
    // The actual scrolling container is the first child with overflow-x-auto
    const el = wrapper.querySelector('.overflow-x-auto') || wrapper;
    const check = () => {
      const overflows = el.scrollWidth > el.clientWidth;
      const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 16;
      setBracketOverflows(overflows && !nearEnd);
    };
    // Defer initial check to avoid synchronous setState in effect body
    const frame = requestAnimationFrame(check);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => { cancelAnimationFrame(frame); ro.disconnect(); el.removeEventListener('scroll', check); };
  }, [tournament?.rounds]);

  useEffect(() => {
    if (!tournamentId || tournament) return;
    reRequestingRef.current = true;
    socket.emit('join_tournament', { tournamentId, username, avatar });
    const resetTimer = setTimeout(() => { reRequestingRef.current = false; }, 3000);
    return () => clearTimeout(resetTimer);
  }, [tournamentId, tournament, username, avatar]);

  const handleCopyId = () => {
    navigator.clipboard?.writeText(tournamentId).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  const handleShare = async () => {
    const shareData = {
      title: 'GridLock Tournament',
      text: `Join my GridLock tournament! Code: ${tournamentId}`,
      url: window.location.href,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); }
      catch { handleCopyId(); }
    } else {
      handleCopyId();
    }
  };

  if (!tournament) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
      >
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-current border-t-current rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading tournament…</p>
        </div>
      </div>
    );
  }

  const isWaiting = tournament.status === 'waiting';
  const spotsLeft = tournament.tournamentSize - tournament.participants.length;

  return (
    <div
      className="min-h-screen flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 safe-bottom"
      style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))' }}
    >
      <div className="w-full max-w-2xl">

        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 bg-clip-text text-transparent leading-tight">
            🏆 Tournament
          </h1>
          <p className="text-sm mt-1 tracking-widest uppercase" style={{ color: 'var(--label-color)' }}>
            {tournament.tournamentSize} Players · {tournament.gridSize}×{tournament.gridSize} Grid
          </p>
        </div>

        {/* Card */}
        {socketError && (
          <div className="mb-4 rounded-xl p-3 text-center text-sm" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)' }}>
            {socketError}
          </div>
        )}
        <div
          className="backdrop-blur-md rounded-2xl overflow-hidden shadow-2xl"
          style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-color-strong)' }}
        >

          {/* Tournament ID + Status */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--label-color)' }}>Tournament ID</label>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold tracking-wider" style={{ color: 'var(--text-primary)' }}>{tournamentId}</span>
                  <button
                    onClick={handleCopyId}
                    className="text-xs px-2 py-1 rounded-lg transition-all active:scale-95"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  >
                    {showCopied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                  <button
                    onClick={handleShare}
                    className="text-xs px-2 py-1 rounded-lg transition-all active:scale-95"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                    aria-label="Share tournament ID"
                  >
                    📤 Share
                  </button>
                </div>
              </div>
              <div className="px-3 py-1.5 rounded-full text-xs font-bold uppercase"
                style={isWaiting
                  ? { backgroundColor: 'color-mix(in srgb, var(--warning) 15%, transparent)', color: 'var(--warning)', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }
                  : completed
                  ? { backgroundColor: 'color-mix(in srgb, var(--success) 15%, transparent)', color: 'var(--success)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }
                  : { backgroundColor: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }
                }>
                {isWaiting ? `⏳ ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` : completed ? '🏆 Complete' : '🎮 In Progress'}
              </div>
            </div>
          </div>

          {/* Participants */}
          <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <label className="block text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--label-color)' }}>
              Players ({tournament.participants.length}/{tournament.tournamentSize})
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {tournament.participants.map((p, i) => (
                <div
                  key={i}
                  className={`rounded-xl p-3 text-center transition-all ${
                    p.username === username ? 'ring-2 ring-[var(--accent)]' : ''
                  }`}
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
                >
                  <div className="text-2xl mb-1">{p.avatar}</div>
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{p.username}</div>
                  {p.username === username && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>You</div>
                  )}
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: spotsLeft > 0 ? spotsLeft : 0 }, (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="rounded-xl p-3 text-center"
                  style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-color-strong)' }}
                >
                  <div className="text-2xl mb-1" style={{ opacity: 0.3, color: 'var(--text-muted)' }}>👤</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting…</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bracket (shown when tournament started) */}
          {tournament.rounds && tournament.rounds.length > 0 && (
            <div className="p-5" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <label className="block text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--label-color)' }}>Bracket</label>
              <div className="relative" ref={bracketRef}>
                <Bracket
                  rounds={tournament.rounds}
                  participants={tournament.participants}
                  champion={tournament.champion}
                />
                {/* Scroll affordance — right-edge fade + hint text when bracket overflows */}
                {bracketOverflows && (
                  <>
                    <div
                      className="pointer-events-none absolute top-0 right-0 bottom-0 w-8"
                      style={{ background: 'linear-gradient(to left, var(--bg-card), transparent)' }}
                      aria-hidden="true"
                    />
                    <div
                      className="text-center mt-1 text-xs motion-safe:animate-pulse"
                      style={{ color: 'var(--text-muted)' }}
                      aria-hidden="true"
                    >
                      Scroll to see more →
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Waiting message */}
          {isWaiting && (
            <div className="p-5 text-center">
              <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <span className="w-4 h-4 border-2 border-current border-t-current rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, currentColor 40%, transparent)', borderTopColor: 'currentColor' }} />
                Share the Tournament ID with friends to start!
              </div>
            </div>
          )}

          {/* In progress — waiting for match assignment */}
          {!isWaiting && !completed && (
            <div className="p-5 text-center">
              <div className="flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--warning)' }}>
                <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'color-mix(in srgb, var(--warning) 40%, transparent)', borderTopColor: 'var(--warning)' }} />
                Waiting for your next match…
              </div>
            </div>
          )}
        </div>

        {/* Winner overlay */}
        {completed && winner && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div
              className="rounded-2xl p-8 w-full max-w-sm shadow-2xl text-center"
              style={{ background: 'linear-gradient(to bottom right, var(--gradient-from), var(--gradient-via), var(--gradient-to))', border: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)' }}
            >
              <div className="text-6xl mb-3 animate-bounce">
                {tournament.participants.find((p) => p.username === winner)?.avatar || '🏆'}
              </div>
              <h2 className="text-3xl font-extrabold mb-2" style={{ color: 'var(--warning)' }}>
                {winner} Wins!
              </h2>
              <p className="text-lg mb-1" style={{ color: 'var(--warning)' }}>🏆 Tournament Champion 🏆</p>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
                {tournament.tournamentSize}-player tournament · {tournament.gridSize}×{tournament.gridSize}
              </p>

              <div className="flex justify-center gap-1 text-2xl mb-6">
                {['🎉', '✨', '🏆', '✨', '🎉'].map((e, i) => (
                  <span key={i} className="animate-bounce" style={{ animationDelay: `${i * 0.1}s` }}>{e}</span>
                ))}
              </div>

              <button
                onClick={() => navigate('/')}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95"
                style={{ background: 'var(--warning)' }}
              >
                👋 Back to Lobby
              </button>
            </div>
          </div>
        )}

        {/* Back to lobby link */}
        <div className="text-center mt-4">
          <button
            onClick={() => navigate('/')}
            className="text-xs transition-all"
            style={{ color: 'var(--text-subtle)' }}
          >
            ← Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};

export default TournamentLobby;
