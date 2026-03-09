// src/components/ReplayPage.jsx
// Animated game replay viewer with play/pause, speed control, and scrubber

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import useThemeColors from '../hooks/useThemeColors';

const API_BASE = import.meta.env.VITE_API_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '');

const PLAYER_CONFIG = {
    player1: { colorVar: '--player1-color', bgVar: '--player1-bg', label: 'P1' },
    player2: { colorVar: '--player2-color', bgVar: '--player2-bg', label: 'P2' },
    player3: { colorVar: '--player3-color', bgVar: '--player3-bg', label: 'P3' },
    player4: { colorVar: '--player4-color', bgVar: '--player4-bg', label: 'P4' },
};

const getConfig = (playerId) => PLAYER_CONFIG[playerId] || PLAYER_CONFIG.player1;

const SPEEDS = [
    { label: '1x', ms: 500 },
    { label: '2x', ms: 250 },
    { label: '4x', ms: 125 },
];

// ─── Responsive sizing hook (same as Board.jsx) ──────────────────────────────
function useGridSizes(gridSize) {
    const [sizes, setSizes] = useState({ dot: 8, line: 48, box: 48 });

    useEffect(() => {
        function calculate() {
            const w = window.innerWidth;
            const h = window.innerHeight;
            const reservedH = w < 640 ? 280 : w < 768 ? 300 : 320;
            const reservedW = w < 640 ? 32 : w < 768 ? 48 : 64;
            const availW = w - reservedW;
            const availH = h - reservedH;
            const cells = gridSize || 3;
            const units = cells * 2 + 1;
            const fromW = Math.floor(availW / units);
            const fromH = Math.floor(availH / units);
            let box = Math.min(fromW, fromH);
            const maxBox = w < 640 ? 90 : w < 1024 ? 96 : 100;
            box = Math.max(24, Math.min(box, maxBox));
            const dot = Math.max(6, Math.round(box * 0.18));
            setSizes({ dot, line: box, box });
        }
        calculate();
        window.addEventListener('resize', calculate);
        return () => window.removeEventListener('resize', calculate);
    }, [gridSize]);

    return sizes;
}

// ─── Initialize empty game state ─────────────────────────────────────────────
function initEmptyState(gridSize, playerCount) {
    const rows = gridSize;
    const cols = gridSize;
    const horizontalLines = Array(rows + 1).fill(null).map(() => Array(cols).fill(null));
    const verticalLines = Array(rows).fill(null).map(() => Array(cols + 1).fill(null));
    const boxes = Array(rows).fill(null).map(() => Array(cols).fill(null));
    const players = [];
    const scores = {};
    for (let i = 1; i <= playerCount; i++) {
        const pid = `player${i}`;
        players.push(pid);
        scores[pid] = 0;
    }
    return { horizontalLines, verticalLines, boxes, scores, currentPlayer: 'player1', winner: null, playerCount, players };
}

// ─── Apply a single move to game state (returns new state) ───────────────────
function applyMove(state, gridSize, move) {
    const rows = gridSize;
    const cols = gridSize;
    const horizontalLines = state.horizontalLines.map(r => [...r]);
    const verticalLines = state.verticalLines.map(r => [...r]);
    const boxes = state.boxes.map(r => [...r]);
    const scores = { ...state.scores };
    let currentPlayer = move.player;

    const isBoxComplete = (row, col) => {
        if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
        return (
            horizontalLines[row][col] !== null &&
            horizontalLines[row + 1][col] !== null &&
            verticalLines[row][col] !== null &&
            verticalLines[row][col + 1] !== null
        );
    };

    if (move.type === 'h') {
        horizontalLines[move.row][move.col] = currentPlayer;
    } else {
        verticalLines[move.row][move.col] = currentPlayer;
    }

    let completed = false;
    if (move.type === 'h') {
        if (move.row < rows && isBoxComplete(move.row, move.col) && boxes[move.row][move.col] === null) {
            boxes[move.row][move.col] = currentPlayer;
            completed = true;
            scores[currentPlayer] = (scores[currentPlayer] || 0) + 1;
        }
        if (move.row > 0 && isBoxComplete(move.row - 1, move.col) && boxes[move.row - 1][move.col] === null) {
            boxes[move.row - 1][move.col] = currentPlayer;
            completed = true;
            scores[currentPlayer] = (scores[currentPlayer] || 0) + 1;
        }
    } else {
        if (move.col < cols && isBoxComplete(move.row, move.col) && boxes[move.row][move.col] === null) {
            boxes[move.row][move.col] = currentPlayer;
            completed = true;
            scores[currentPlayer] = (scores[currentPlayer] || 0) + 1;
        }
        if (move.col > 0 && isBoxComplete(move.row, move.col - 1) && boxes[move.row][move.col - 1] === null) {
            boxes[move.row][move.col - 1] = currentPlayer;
            completed = true;
            scores[currentPlayer] = (scores[currentPlayer] || 0) + 1;
        }
    }

    // Check winner
    const totalBoxes = rows * cols;
    const completedBoxes = state.players.reduce((sum, p) => sum + (scores[p] || 0), 0);
    let winner = null;
    if (completedBoxes >= totalBoxes) {
        let maxScore = -1;
        let winners = [];
        state.players.forEach(p => {
            if ((scores[p] || 0) > maxScore) { maxScore = scores[p] || 0; winners = [p]; }
            else if ((scores[p] || 0) === maxScore) { winners.push(p); }
        });
        winner = winners.length === 1 ? winners[0] : 'draw';
    }

    // Determine next player
    let nextPlayer = currentPlayer;
    if (!completed && !winner) {
        const idx = state.players.indexOf(currentPlayer);
        nextPlayer = state.players[(idx + 1) % state.players.length];
    }

    return {
        horizontalLines, verticalLines, boxes, scores,
        currentPlayer: nextPlayer, winner, playerCount: state.playerCount, players: state.players,
    };
}

// ─── Main Component ──────────────────────────────────────────────────────────
const ReplayPage = () => {
    const { gameId } = useParams();
    const navigate = useNavigate();
    const themeColors = useThemeColors();
    const getCSSVar = (varName) => themeColors[varName] || '';

    const [replayData, setReplayData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [moveIndex, setMoveIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speedIdx, setSpeedIdx] = useState(0);
    const [showWinner, setShowWinner] = useState(false);

    const confettiFired = useRef(false);
    const timerRef = useRef(null);

    // Fetch replay data
    useEffect(() => {
        let cancelled = false;
        async function fetchReplay() {
            try {
                const res = await fetch(`${API_BASE}/api/games/${gameId}/replay`);
                if (!res.ok) {
                    if (res.status === 404) {
                        setError('not_found');
                    } else {
                        setError('server_error');
                    }
                    setLoading(false);
                    return;
                }
                const data = await res.json();
                if (!cancelled) {
                    setReplayData(data);
                    setLoading(false);
                    if (data.moveHistory && data.moveHistory.length > 0) {
                        setIsPlaying(true);
                    }
                }
            } catch {
                if (!cancelled) {
                    setError('network_error');
                    setLoading(false);
                }
            }
        }
        fetchReplay();
        return () => { cancelled = true; };
    }, [gameId]);

    // Compute game state at current moveIndex
    const gridSize = replayData?.gridSize || 3;
    const playerCount = replayData?.playerCount || 2;
    const sizes = useGridSizes(gridSize);

    const gameState = useCallback(() => {
        if (!replayData) return null;
        let state = initEmptyState(replayData.gridSize, replayData.playerCount);
        const moves = replayData.moveHistory || [];
        for (let i = 0; i < moveIndex; i++) {
            if (moves[i]) {
                state = applyMove(state, replayData.gridSize, moves[i]);
            }
        }
        return state;
    }, [replayData, moveIndex])();

    const totalMoves = replayData?.moveHistory?.length || 0;

    // Auto-play timer
    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isPlaying && moveIndex < totalMoves) {
            timerRef.current = setInterval(() => {
                setMoveIndex(prev => {
                    if (prev >= totalMoves) {
                        setIsPlaying(false);
                        return prev;
                    }
                    return prev + 1;
                });
            }, SPEEDS[speedIdx].ms);
        }
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [isPlaying, speedIdx, totalMoves, moveIndex]);

    // Stop playing when reached end
    useEffect(() => {
        if (moveIndex >= totalMoves && totalMoves > 0) {
            setIsPlaying(false);
        }
    }, [moveIndex, totalMoves]);

    // Winner celebration
    useEffect(() => {
        if (gameState?.winner && moveIndex >= totalMoves && !confettiFired.current) {
            confettiFired.current = true;
            setShowWinner(true);
            const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!prefersReduced && gameState.winner !== 'draw') {
                confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
            }
        }
        if (moveIndex < totalMoves) {
            confettiFired.current = false;
            setShowWinner(false);
        }
    }, [gameState?.winner, moveIndex, totalMoves]);

    // ── Share replay link ────────────────────────────────────────────────────
    const [shareStatus, setShareStatus] = useState(null);
    const handleShare = async () => {
        const url = `https://gridlock.snapurl.in/replay/${gameId}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'GridLock Replay', url });
                setShareStatus('shared');
            } catch {
                // User cancelled
            }
        } else if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(url);
                setShareStatus('copied');
            } catch {
                setShareStatus(null);
            }
        }
        setTimeout(() => setShareStatus(null), 2000);
    };

    // ── Render helpers ───────────────────────────────────────────────────────
    const getPlayerColor = (playerId) => {
        if (!playerId) return null;
        const cfg = getConfig(playerId);
        return getCSSVar(cfg.colorVar);
    };

    const renderDot = (key) => (
        <div key={key} style={{ width: sizes.dot, height: sizes.dot, flexShrink: 0 }}
            className="flex items-center justify-center z-10">
            <div className="rounded-full shadow-sm"
                style={{ width: sizes.dot - 2, height: sizes.dot - 2, backgroundColor: 'var(--dot-color)' }} />
        </div>
    );

    const renderHLine = (r, c) => {
        const owner = gameState?.horizontalLines[r]?.[c];
        const lineColor = owner ? getPlayerColor(owner) : null;
        // Highlight the latest move
        const lastMove = moveIndex > 0 ? replayData.moveHistory[moveIndex - 1] : null;
        const isLatest = lastMove && lastMove.type === 'h' && lastMove.row === r && lastMove.col === c;

        return (
            <div key={`h-${r}-${c}`} style={{ width: sizes.line, height: sizes.dot, flexShrink: 0 }}
                className="flex items-center px-0.5">
                <div className={`h-2 w-full rounded transition-all duration-200 ${isLatest ? 'ring-2' : ''}`}
                    style={{
                        backgroundColor: lineColor || 'var(--line-empty)',
                        opacity: owner ? 1 : 0.5,
                        boxShadow: isLatest && lineColor ? `0 0 10px ${lineColor}` : (owner && lineColor ? `0 0 6px ${lineColor}40` : undefined),
                        ringColor: isLatest ? lineColor : undefined,
                    }} />
            </div>
        );
    };

    const renderVLine = (r, c) => {
        const owner = gameState?.verticalLines[r]?.[c];
        const lineColor = owner ? getPlayerColor(owner) : null;
        const lastMove = moveIndex > 0 ? replayData.moveHistory[moveIndex - 1] : null;
        const isLatest = lastMove && lastMove.type === 'v' && lastMove.row === r && lastMove.col === c;

        return (
            <div key={`v-${r}-${c}`} style={{ width: sizes.dot, height: sizes.line, flexShrink: 0 }}
                className="flex justify-center py-0.5">
                <div className={`w-2 h-full rounded transition-all duration-200 ${isLatest ? 'ring-2' : ''}`}
                    style={{
                        backgroundColor: lineColor || 'var(--line-empty)',
                        opacity: owner ? 1 : 0.5,
                        boxShadow: isLatest && lineColor ? `0 0 10px ${lineColor}` : (owner && lineColor ? `0 0 6px ${lineColor}40` : undefined),
                        ringColor: isLatest ? lineColor : undefined,
                    }} />
            </div>
        );
    };

    const renderBox = (r, c) => {
        const owner = gameState?.boxes[r]?.[c];
        const cfg = owner ? getConfig(owner) : null;
        const playerInfo = owner && replayData?.players?.[owner];
        const ownerAvatar = playerInfo?.avatar || (cfg ? cfg.label : null);

        return (
            <div key={`b-${r}-${c}`} style={{ width: sizes.line, height: sizes.line, flexShrink: 0 }}
                className="flex items-center justify-center">
                <div className="w-full h-full flex items-center justify-center rounded transition-all duration-300"
                    style={cfg ? { backgroundColor: `var(${cfg.bgVar})` } : undefined}>
                    {ownerAvatar && owner && (
                        <span style={{ fontSize: Math.max(sizes.box * 0.38, 12) }}>{ownerAvatar}</span>
                    )}
                </div>
            </div>
        );
    };

    // ── Error/Loading states ─────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
                style={{ backgroundColor: 'var(--bg-primary)' }}>
                <div className="text-5xl mb-4 animate-pulse">🎬</div>
                <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Loading Replay…</h2>
                <div className="mt-4 flex gap-1 justify-center">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="w-2 h-2 rounded-full animate-bounce"
                            style={{ backgroundColor: 'var(--accent)', animationDelay: `${i * 0.15}s` }} />
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
                style={{ backgroundColor: 'var(--bg-primary)' }}>
                <div className="text-5xl mb-4">
                    {error === 'not_found' ? '🔍' : '⚠️'}
                </div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    {error === 'not_found' ? 'Game Not Found' : 'Something went wrong'}
                </h2>
                <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                    {error === 'not_found'
                        ? 'This replay may have expired or the game ID is invalid.'
                        : 'Could not load the replay. Please try again.'}
                </p>
                <button
                    onClick={() => navigate('/')}
                    className="px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                        background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                        color: 'var(--text-on-accent)',
                    }}
                >
                    🎮 Play GridLock
                </button>
            </div>
        );
    }

    if (!replayData || totalMoves === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
                style={{ backgroundColor: 'var(--bg-primary)' }}>
                <div className="text-5xl mb-4">📭</div>
                <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                    No Moves Recorded
                </h2>
                <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
                    {replayData?.status === 'abandoned'
                        ? 'This game was abandoned before any moves were made.'
                        : 'This game has no recorded move history.'}
                </p>
                <button
                    onClick={() => navigate('/')}
                    className="px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                    style={{
                        background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                        color: 'var(--text-on-accent)',
                    }}
                >
                    🎮 Play GridLock
                </button>
            </div>
        );
    }

    // ── Main Replay UI ───────────────────────────────────────────────────────
    const playerIds = Array.from({ length: playerCount }, (_, i) => `player${i + 1}`);

    return (
        <div className="flex flex-col items-center" style={{ minHeight: '100dvh', backgroundColor: 'var(--bg-primary)' }}>
            {/* Header */}
            <div className="w-full max-w-2xl px-4 pt-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <Link to="/" className="text-sm font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}>
                        ← Back
                    </Link>
                    <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                        🎬 Game Replay
                    </h1>
                    <button onClick={handleShare}
                        className="text-sm font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--success)', border: '1px solid var(--border-color)' }}>
                        {shareStatus === 'copied' ? '✅ Copied!' : shareStatus === 'shared' ? '✅ Shared!' : '📤 Share'}
                    </button>
                </div>

                {/* Player scores */}
                <div className={`grid gap-2 mb-3 ${playerCount <= 2 ? 'grid-cols-2' : playerCount === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
                    {playerIds.map(pid => {
                        const cfg = getConfig(pid);
                        const playerColor = getCSSVar(cfg.colorVar);
                        const playerInfo = replayData.players?.[pid];
                        const name = playerInfo?.username || `Player ${pid.slice(6)}`;
                        const avatar = playerInfo?.avatar || '👤';
                        const score = gameState?.scores?.[pid] ?? 0;
                        const isCurrent = gameState?.currentPlayer === pid && !gameState?.winner;

                        return (
                            <div key={pid}
                                className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 transition-all duration-300"
                                style={{
                                    backgroundColor: isCurrent ? `var(${cfg.bgVar})` : 'var(--bg-secondary)',
                                    borderColor: isCurrent ? playerColor : 'var(--border-color)',
                                    ...(isCurrent ? { boxShadow: `0 0 12px ${playerColor}30`, transform: 'scale(1.05)' } : {}),
                                }}>
                                <span className="text-xl leading-none">{avatar}</span>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold truncate text-xs" style={{ color: isCurrent ? playerColor : 'var(--text-primary)' }}>
                                        {name}
                                        {playerInfo?.isCPU && <span className="ml-1">🤖</span>}
                                    </div>
                                    <div className="text-lg font-extrabold leading-none" style={{ color: playerColor }}>
                                        {score}
                                    </div>
                                </div>
                                {isCurrent && <span className="text-sm font-bold animate-pulse" style={{ color: playerColor }}>▶</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Board */}
            <div className="flex flex-1 items-center justify-center w-full px-2">
                <div className="relative rounded-2xl shadow-xl select-none board-container mx-auto"
                    style={{
                        touchAction: 'pan-y', padding: '12px',
                        backgroundColor: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                    }}>
                    {gameState?.horizontalLines.map((row, r) => (
                        <div key={`row-${r}`}>
                            <div className="flex items-center">
                                {row.map((_, c) => (
                                    <React.Fragment key={`top-${c}`}>
                                        {renderDot(`d-${r}-${c}`)}
                                        {renderHLine(r, c)}
                                    </React.Fragment>
                                ))}
                                {renderDot(`d-${r}-end`)}
                            </div>
                            {r < gameState.boxes.length && (
                                <div className="flex items-center">
                                    {gameState.boxes[r].map((_, c) => (
                                        <React.Fragment key={`mid-${c}`}>
                                            {renderVLine(r, c)}
                                            {renderBox(r, c)}
                                        </React.Fragment>
                                    ))}
                                    {renderVLine(r, gameState.boxes[r].length)}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div className="w-full max-w-md px-4 pb-6 pt-3">
                {/* Move counter */}
                <div className="text-center mb-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        Move {moveIndex} / {totalMoves}
                    </span>
                    {showWinner && replayData.winner && (
                        <span className="ml-2 text-sm font-bold" style={{ color: 'var(--winner-gold)' }}>
                            {replayData.winner === 'draw' ? '🤝 Draw!' : `🏆 ${replayData.players?.[replayData.winner]?.username || replayData.winner} wins!`}
                        </span>
                    )}
                </div>

                {/* Scrubber */}
                <input
                    type="range"
                    min={0}
                    max={totalMoves}
                    value={moveIndex}
                    onChange={(e) => {
                        setMoveIndex(Number(e.target.value));
                        setIsPlaying(false);
                    }}
                    className="w-full mb-3 accent-[var(--accent)]"
                    style={{ accentColor: 'var(--accent)' }}
                    aria-label="Replay scrubber"
                />

                {/* Play/Pause + Speed */}
                <div className="flex items-center justify-center gap-3">
                    {/* Reset */}
                    <button
                        onClick={() => { setMoveIndex(0); setIsPlaying(false); confettiFired.current = false; setShowWinner(false); }}
                        className="px-3 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
                        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        aria-label="Reset replay"
                    >
                        ⏮
                    </button>

                    {/* Play/Pause */}
                    <button
                        onClick={() => {
                            if (moveIndex >= totalMoves) {
                                setMoveIndex(0);
                                confettiFired.current = false;
                                setShowWinner(false);
                            }
                            setIsPlaying(p => !p);
                        }}
                        className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                        style={{
                            background: isPlaying
                                ? 'var(--bg-surface)'
                                : 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                            color: isPlaying ? 'var(--text-primary)' : 'var(--text-on-accent)',
                            border: isPlaying ? '1px solid var(--border-color)' : 'none',
                        }}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                        {isPlaying ? '⏸ Pause' : '▶ Play'}
                    </button>

                    {/* Speed selector */}
                    <button
                        onClick={() => setSpeedIdx(i => (i + 1) % SPEEDS.length)}
                        className="px-3 py-2 rounded-xl font-bold text-sm transition-all active:scale-95"
                        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--accent)', border: '1px solid var(--border-color)' }}
                        aria-label={`Speed: ${SPEEDS[speedIdx].label}`}
                    >
                        {SPEEDS[speedIdx].label}
                    </button>
                </div>

                {/* Play GridLock CTA */}
                <div className="mt-4 text-center">
                    <button
                        onClick={() => navigate('/')}
                        className="px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 hover:shadow-lg"
                        style={{
                            background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
                            color: 'var(--text-on-accent)',
                        }}
                    >
                        🎮 Play GridLock
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReplayPage;
