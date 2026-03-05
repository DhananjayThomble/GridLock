// src/components/TournamentLobby.jsx
// Tournament lobby — waiting room, bracket display, real-time updates

import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import socket from '../socket';
import Bracket from './Bracket';

const TournamentLobby = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tournamentId: initialTournamentId, username, avatar } = location.state || {};

  const [tournament, setTournament] = useState(location.state?.tournament || null);
  const [showCopied, setShowCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [winner, setWinner] = useState(null);
  const navigatedRef = useRef(false);

  const tournamentId = tournament?.tournamentId || initialTournamentId;

  // ── Socket events ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!tournamentId) {
      navigate('/');
      return;
    }

    const onTournamentUpdate = ({ tournament: t }) => {
      setTournament(t);
    };

    const onTournamentGameAssigned = ({ gameId, opponentName, roundIndex, matchIndex, gridSize }) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;
      navigate('/game', {
        state: {
          username,
          gameId,
          role: 'player_joining',
          avatar,
          playerCount: 2,
          gridSize,
          tournamentId,
          tournamentRound: roundIndex,
          tournamentMatch: matchIndex,
          opponentName,
        },
      });
    };

    const onTournamentCompleted = ({ tournament: t, winner: w }) => {
      setTournament(t);
      setWinner(w);
      setCompleted(true);
    };

    const onError = (msg) => {
      alert(typeof msg === 'string' ? msg : 'Something went wrong');
    };

    socket.on('tournament_update', onTournamentUpdate);
    socket.on('tournament_game_assigned', onTournamentGameAssigned);
    socket.on('tournament_completed', onTournamentCompleted);
    socket.on('error', onError);

    return () => {
      socket.off('tournament_update', onTournamentUpdate);
      socket.off('tournament_game_assigned', onTournamentGameAssigned);
      socket.off('tournament_completed', onTournamentCompleted);
      socket.off('error', onError);
    };
  }, [tournamentId, username, avatar, navigate]);

  // Reset navigation guard when tournamentId changes
  useEffect(() => {
    navigatedRef.current = false;
  }, [tournamentId]);

  // ── Copy tournament ID ────────────────────────────────────────────────────────
  const handleCopyId = () => {
    navigator.clipboard?.writeText(tournamentId).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  };

  // ── No tournament data ────────────────────────────────────────────────────────
  if (!tournament) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/40 border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-white/60 text-sm">Loading tournament…</p>
        </div>
      </div>
    );
  }

  const isWaiting = tournament.status === 'waiting';
  const spotsLeft = tournament.tournamentSize - tournament.participants.length;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-start justify-center p-3 pt-6 sm:p-4 sm:pt-8 safe-bottom">
      <div className="w-full max-w-2xl">

        {/* Title */}
        <div className="text-center mb-6">
          <h1 className="text-4xl sm:text-5xl font-extrabold bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-400 bg-clip-text text-transparent leading-tight">
            🏆 Tournament
          </h1>
          <p className="text-blue-300 text-sm mt-1 tracking-widest uppercase">
            {tournament.tournamentSize} Players · {tournament.gridSize}×{tournament.gridSize} Grid
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden shadow-2xl">

          {/* Tournament ID + Status */}
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-1">Tournament ID</label>
                <div className="flex items-center gap-2">
                  <span className="text-white font-mono text-lg font-bold tracking-wider">{tournamentId}</span>
                  <button
                    onClick={handleCopyId}
                    className="text-xs bg-white/10 hover:bg-white/20 text-white/70 px-2 py-1 rounded-lg transition-all active:scale-95"
                  >
                    {showCopied ? '✅ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase ${
                isWaiting
                  ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                  : completed
                  ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}>
                {isWaiting ? `⏳ ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` : completed ? '🏆 Complete' : '🎮 In Progress'}
              </div>
            </div>
          </div>

          {/* Participants */}
          <div className="p-5 border-b border-white/10">
            <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-3">
              Players ({tournament.participants.length}/{tournament.tournamentSize})
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {tournament.participants.map((p, i) => (
                <div
                  key={i}
                  className={`bg-white/5 rounded-xl border border-white/10 p-3 text-center transition-all ${
                    p.username === username ? 'ring-2 ring-blue-400' : ''
                  }`}
                >
                  <div className="text-2xl mb-1">{p.avatar}</div>
                  <div className="text-white text-xs font-semibold truncate">{p.username}</div>
                  {p.username === username && (
                    <div className="text-blue-400 text-xs mt-0.5">You</div>
                  )}
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: spotsLeft > 0 ? spotsLeft : 0 }, (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="bg-white/5 rounded-xl border border-dashed border-white/20 p-3 text-center"
                >
                  <div className="text-2xl mb-1 opacity-30">❓</div>
                  <div className="text-white/30 text-xs">Waiting…</div>
                </div>
              ))}
            </div>
          </div>

          {/* Bracket (shown when tournament started) */}
          {tournament.rounds && tournament.rounds.length > 0 && (
            <div className="p-5 border-b border-white/10">
              <label className="block text-blue-200 text-xs font-bold uppercase tracking-wider mb-3">Bracket</label>
              <Bracket
                rounds={tournament.rounds}
                participants={tournament.participants}
                champion={tournament.champion}
              />
            </div>
          )}

          {/* Waiting message */}
          {isWaiting && (
            <div className="p-5 text-center">
              <div className="flex items-center justify-center gap-2 text-white/60 text-sm">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Share the Tournament ID with friends to start!
              </div>
            </div>
          )}

          {/* In progress — waiting for match assignment */}
          {!isWaiting && !completed && (
            <div className="p-5 text-center">
              <div className="flex items-center justify-center gap-2 text-yellow-300 text-sm">
                <span className="w-4 h-4 border-2 border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin" />
                Waiting for your next match…
              </div>
            </div>
          )}
        </div>

        {/* Winner overlay */}
        {completed && winner && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl border border-yellow-500/30 p-8 w-full max-w-sm shadow-2xl text-center">
              <div className="text-6xl mb-3 animate-bounce">
                {tournament.participants.find((p) => p.username === winner)?.avatar || '🏆'}
              </div>
              <h2 className="text-3xl font-extrabold text-yellow-400 mb-2">
                {winner} Wins!
              </h2>
              <p className="text-yellow-500/80 text-lg mb-1">🏆 Tournament Champion 🏆</p>
              <p className="text-white/40 text-sm mb-6">
                {tournament.tournamentSize}-player tournament · {tournament.gridSize}×{tournament.gridSize}
              </p>

              {/* Confetti-style decoration */}
              <div className="flex justify-center gap-1 text-2xl mb-6">
                {['🎉', '✨', '🏆', '✨', '🎉'].map((e, i) => (
                  <span key={i} className="animate-bounce" style={{ animationDelay: `${i * 0.1}s` }}>{e}</span>
                ))}
              </div>

              <button
                onClick={() => navigate('/')}
                className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95"
                style={{ background: 'linear-gradient(135deg,#F59E0B,#D97706)' }}
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
            className="text-white/30 hover:text-white/60 text-xs transition-all"
          >
            ← Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
};

export default TournamentLobby;
