// src/components/GameDemo.jsx — Animated 2×2 dots-and-boxes demo for onboarding.
// Shows a realistic turn-by-turn game: players alternate, captures give extra turns.
// Theme-aware, pure CSS transitions, auto-loops.
import React, { useEffect, useRef, useState } from 'react';
import { useGridTheme } from '../contexts/GridThemeContext';

const GRID = 2, DOTS = 3;

// Realistic turn-by-turn sequence on a 2×2 grid:
// P1 and P2 alternate. Captures grant extra turns (real game rules).
const MOVES = [
  { delay: 0,    type: 'h', row: 0, col: 0, player: 1 },                    // P1: top-left ─
  { delay: 1200, type: 'v', row: 0, col: 2, player: 2 },                    // P2: right-top │
  { delay: 2400, type: 'v', row: 0, col: 0, player: 1 },                    // P1: left-top │
  { delay: 3600, type: 'h', row: 2, col: 1, player: 2 },                    // P2: bottom-right ─
  { delay: 4800, type: 'h', row: 1, col: 0, player: 1 },                    // P1: middle-left ─
  { delay: 6000, type: 'v', row: 0, col: 1, player: 2 },                    // P2: middle-top │ → completes top-left box!
  { delay: 6000, capture: [0, 0], capturePlayer: 2 },                        // P2 captures box [0,0]
  { delay: 7500, type: 'h', row: 0, col: 1, player: 2 },                    // P2 extra turn: top-right ─ → completes top-right box!
  { delay: 7500, capture: [0, 1], capturePlayer: 2 },                        // P2 captures box [0,1]
  { delay: 9000, type: 'v', row: 1, col: 0, player: 2 },                    // P2 extra: left-bottom │
  { delay: 10200, type: 'h', row: 2, col: 0, player: 1 },                   // P1: bottom-left ─ → completes bottom-left box!
  { delay: 10200, capture: [1, 0], capturePlayer: 1 },                       // P1 captures box [1,0]
  { delay: 11700, type: 'v', row: 1, col: 1, player: 1 },                   // P1 extra: middle-bottom │
  { delay: 12900, type: 'h', row: 1, col: 1, player: 2 },                   // P2: middle-right ─
  { delay: 14100, type: 'v', row: 1, col: 2, player: 1 },                   // P1: right-bottom │ → completes bottom-right box!
  { delay: 14100, capture: [1, 1], capturePlayer: 1 },                       // P1 captures box [1,1]
];
// Final score: P1: 2, P2: 2 — Draw! (demonstrates all outcomes)
const LOOP_MS = 17000; // full cycle including pause

export default function GameDemo() {
  const { theme } = useGridTheme();
  const [lines, setLines] = useState({});
  const [boxes, setBoxes] = useState({});
  const [score, setScore] = useState([0, 0]);
  const [turn, setTurn] = useState(null); // current player indicator
  const tRef = useRef([]);

  useEffect(() => {
    let off = false;
    const sched = (fn, ms) => { const t = setTimeout(fn, ms); tRef.current.push(t); };

    const cycle = () => {
      if (off) return;
      setLines({}); setBoxes({}); setScore([0, 0]); setTurn(1);

      MOVES.forEach(({ delay, type, row, col, player, capture, capturePlayer }) => {
        if (capture) {
          // Box capture event
          sched(() => {
            if (off) return;
            setBoxes(p => ({ ...p, [`${capture[0]}-${capture[1]}`]: capturePlayer }));
            setScore(p => {
              const s = [...p];
              s[capturePlayer - 1]++;
              return s;
            });
          }, delay + 200); // slight delay after line for dramatic effect
        } else {
          // Line placement
          sched(() => {
            if (off) return;
            setLines(p => ({ ...p, [`${type}-${row}-${col}`]: player }));
            setTurn(player);
          }, delay);
        }
      });

      // Show "Draw!" state briefly, then reset
      sched(() => { if (!off) setTurn(null); }, LOOP_MS - 2000);
    };

    cycle();
    const iv = setInterval(cycle, LOOP_MS);
    tRef.current.push(iv);
    return () => { off = true; tRef.current.forEach(id => { clearTimeout(id); clearInterval(id); }); tRef.current = []; };
  }, []);

  const { p1, p2 } = theme.players;
  const playerColor = p => p === 1 ? p1.lineColor : p2.lineColor;
  const playerBox = p => p === 1 ? p1.boxBg : p2.boxBg;
  const dot = Math.max(6, theme.visualDotSize || 8);
  const seg = 38, thick = Math.max(3, Math.min(theme.lineThickness || 5, 6));
  const total = DOTS * dot + GRID * seg;
  const tLine = 'background-color .3s, opacity .3s';
  const tBox = 'transform .4s ease-out, background-color .3s';
  const els = [];

  // Dots
  for (let r = 0; r < DOTS; r++) for (let c = 0; c < DOTS; c++) {
    const x = c * (dot + seg), y = r * (dot + seg);
    els.push(<div key={`d${r}${c}`} data-testid="demo-dot" style={{
      position: 'absolute', left: x, top: y, width: dot, height: dot,
      borderRadius: '50%', backgroundColor: theme.dotColor, ...theme.dotStyle, zIndex: 2
    }} />);

    // Horizontal lines
    if (c < GRID) {
      const k = `h-${r}-${c}`, a = lines[k];
      els.push(<div key={k} data-testid={`demo-${k}`} style={{
        position: 'absolute', left: x + dot, top: y + (dot - thick) / 2,
        width: seg, height: thick, borderRadius: thick / 2,
        backgroundColor: a ? playerColor(a) : theme.emptyLineColor,
        opacity: a ? 1 : 0.25, transition: tLine,
        boxShadow: a ? `0 0 6px ${playerColor(a)}40` : 'none',
        zIndex: 1
      }} />);
    }

    // Vertical lines
    if (r < GRID) {
      const k = `v-${r}-${c}`, a = lines[k];
      els.push(<div key={k} data-testid={`demo-${k}`} style={{
        position: 'absolute', left: x + (dot - thick) / 2, top: y + dot,
        width: thick, height: seg, borderRadius: thick / 2,
        backgroundColor: a ? playerColor(a) : theme.emptyLineColor,
        opacity: a ? 1 : 0.25, transition: tLine,
        boxShadow: a ? `0 0 6px ${playerColor(a)}40` : 'none',
        zIndex: 1
      }} />);
    }
  }

  // Boxes
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const owner = boxes[`${r}-${c}`];
    els.push(<div key={`b${r}${c}`} data-testid={`demo-box-${r}-${c}`} style={{
      position: 'absolute', left: c * (dot + seg) + dot, top: r * (dot + seg) + dot,
      width: seg, height: seg, borderRadius: 3,
      backgroundColor: owner ? playerBox(owner) : 'transparent',
      transform: owner ? 'scale(1)' : 'scale(0)',
      transition: tBox, zIndex: 0
    }} />);
  }

  return (
    <div data-testid="game-demo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 0' }}>
      {/* Turn indicator */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', minHeight: 18 }}>
        {turn ? (
          <span>
            <span style={{ color: playerColor(turn), fontWeight: 700 }}>
              {turn === 1 ? '🟦 Blue' : '🟥 Red'}
            </span>
            {`'s turn`}
          </span>
        ) : score[0] === score[1] ? '🤝 Draw!' : score[0] > score[1] ? '🏆 Blue wins!' : '🏆 Red wins!'}
      </div>

      {/* Grid */}
      <div style={{ position: 'relative', width: total, height: total, margin: '0 auto' }}>{els}</div>

      {/* Score */}
      <div data-testid="demo-score" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 16, fontWeight: 700 }}>
        <span style={{ color: p1.lineColor }}>🟦 {score[0]}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>vs</span>
        <span style={{ color: p2.lineColor }}>🟥 {score[1]}</span>
      </div>
    </div>
  );
}
