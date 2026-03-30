// src/components/GameDemo.jsx — Animated 2×2 dots-and-boxes demo for onboarding.
// Shows "You" winning 3-1 against "Alex" with a chain capture.
// Theme-aware, pure CSS transitions, auto-loops.
import React, { useEffect, useRef, useState } from 'react';
import { useGridTheme } from '../contexts/GridThemeContext';

const GRID = 2, DOTS = 3;

// "You" = player 1 (blue), "Alex" = player 2 (red)
// Sequence: You win 3-1 via chain capture (the core strategy)
// 2×2 grid: h-row-col, v-row-col
// Boxes: [0,0]=TL, [0,1]=TR, [1,0]=BL, [1,1]=BR
const SCRIPT = [
  // Opening moves — alternating, no captures yet
  { at: 500,   line: 'h-0-0', player: 1 },   // You: top-left ─
  { at: 1700,  line: 'v-0-2', player: 2 },   // Alex: right-top │
  { at: 2900,  line: 'h-2-0', player: 1 },   // You: bottom-left ─
  { at: 4100,  line: 'h-2-1', player: 2 },   // Alex: bottom-right ─
  { at: 5300,  line: 'v-0-0', player: 1 },   // You: left-top │
  { at: 6500,  line: 'h-0-1', player: 2 },   // Alex: top-right ─

  // Alex makes a mistake — sets up a chain for You
  { at: 7700,  line: 'v-1-0', player: 1 },   // You: left-bottom │
  { at: 8900,  line: 'h-1-1', player: 2 },   // Alex: middle-right ─ (mistake! opens chain)

  // You trigger the CHAIN CAPTURE! 🔥
  { at: 10100, line: 'h-1-0', player: 1 },   // You: middle-left ─ → captures TL box!
  { at: 10100, capture: [0, 0], by: 1 },
  { at: 11500, line: 'v-0-1', player: 1 },   // You (extra): middle-top │ → captures TR box!
  { at: 11500, capture: [0, 1], by: 1 },
  { at: 12900, line: 'v-1-1', player: 1 },   // You (extra): middle-bottom │ → captures BR box!
  { at: 12900, capture: [1, 1], by: 1 },

  // Alex gets the last box by default
  { at: 14300, line: 'v-1-2', player: 1 },   // You (extra): right-bottom │ → captures BL box!... wait
  // Actually let's give Alex 1 box:
  // Redo: after You chain 3 boxes, You place a non-capturing line, Alex gets last box
];

// Corrected sequence for You: 3, Alex: 1
const MOVES = [
  // Opening — alternating
  { at: 500,   line: 'h-0-0', player: 1 },   // You: top-left ─
  { at: 1700,  line: 'v-0-2', player: 2 },   // Alex: right-top │
  { at: 2900,  line: 'h-2-1', player: 1 },   // You: bottom-right ─
  { at: 4100,  line: 'h-0-1', player: 2 },   // Alex: top-right ─
  { at: 5300,  line: 'v-0-0', player: 1 },   // You: left-top │
  { at: 6500,  line: 'v-1-0', player: 2 },   // Alex: left-bottom │

  // Setup — You place strategically
  { at: 7700,  line: 'h-2-0', player: 1 },   // You: bottom-left ─

  // Alex's mistake — completes 3 sides of TL box
  { at: 8900,  line: 'v-0-1', player: 2 },   // Alex: middle-top │ (mistake!)

  // 🔥 CHAIN! You close TL, chain to BL, chain to BR
  { at: 10100, line: 'h-1-0', player: 1 },   // You: middle-left ─ → TL box!
  { at: 10100, capture: [0, 0], by: 1 },

  { at: 11400, line: 'v-1-1', player: 1 },   // You (chain): middle-bottom │ → BL box!
  { at: 11400, capture: [1, 0], by: 1 },

  { at: 12700, line: 'h-1-1', player: 1 },   // You (chain): middle-right ─ → BR box!
  { at: 12700, capture: [1, 1], by: 1 },

  // You hand off — Alex gets TR
  { at: 14000, line: 'v-1-2', player: 2 },   // Alex gets last box: TR
  { at: 14000, capture: [0, 1], by: 2 },
];

// Final: You 3 — Alex 1 🏆
const LOOP_MS = 18000;

export default function GameDemo() {
  const { theme } = useGridTheme();
  const [lines, setLines] = useState({});
  const [boxes, setBoxes] = useState({});
  const [score, setScore] = useState([0, 0]);
  const [phase, setPhase] = useState('playing'); // 'playing' | 'result'
  const [currentPlayer, setCurrentPlayer] = useState(1);
  const tRef = useRef([]);

  useEffect(() => {
    let off = false;
    const t = (fn, ms) => { const id = setTimeout(fn, ms); tRef.current.push(id); };

    const cycle = () => {
      if (off) return;
      setLines({}); setBoxes({}); setScore([0, 0]);
      setPhase('playing'); setCurrentPlayer(1);

      MOVES.forEach(({ at, line, player, capture, by }) => {
        if (capture) {
          t(() => {
            if (off) return;
            setBoxes(p => ({ ...p, [`${capture[0]}-${capture[1]}`]: by }));
            setScore(p => { const s = [...p]; s[by - 1]++; return s; });
          }, at + 300);
        } else {
          t(() => {
            if (off) return;
            setLines(p => ({ ...p, [line]: player }));
            setCurrentPlayer(player);
          }, at);
        }
      });

      // Show result
      t(() => { if (!off) setPhase('result'); }, LOOP_MS - 3000);
    };

    cycle();
    const iv = setInterval(cycle, LOOP_MS);
    tRef.current.push(iv);
    return () => { off = true; tRef.current.forEach(id => { clearTimeout(id); clearInterval(id); }); tRef.current = []; };
  }, []);

  const { p1, p2 } = theme.players;
  const pColor = p => p === 1 ? p1.lineColor : p2.lineColor;
  const pBox = p => p === 1 ? p1.boxBg : p2.boxBg;
  const dot = Math.max(6, theme.visualDotSize || 8);
  const seg = 40, thick = Math.max(3, Math.min(theme.lineThickness || 5, 6));
  const total = DOTS * dot + GRID * seg;
  const els = [];

  // Dots
  for (let r = 0; r < DOTS; r++) for (let c = 0; c < DOTS; c++) {
    els.push(<div key={`d${r}${c}`} data-testid="demo-dot" style={{
      position: 'absolute', left: c * (dot + seg), top: r * (dot + seg),
      width: dot, height: dot, borderRadius: '50%',
      backgroundColor: theme.dotColor, ...theme.dotStyle, zIndex: 2
    }} />);
  }

  // H-lines
  for (let r = 0; r < DOTS; r++) for (let c = 0; c < GRID; c++) {
    const k = `h-${r}-${c}`, a = lines[k];
    els.push(<div key={k} data-testid={`demo-${k}`} style={{
      position: 'absolute', left: c * (dot + seg) + dot, top: r * (dot + seg) + (dot - thick) / 2,
      width: seg, height: thick, borderRadius: thick / 2,
      backgroundColor: a ? pColor(a) : theme.emptyLineColor,
      opacity: a ? 1 : 0.2, transition: 'all .35s ease',
      boxShadow: a ? `0 0 8px ${pColor(a)}50` : 'none', zIndex: 1
    }} />);
  }

  // V-lines
  for (let r = 0; r < GRID; r++) for (let c = 0; c < DOTS; c++) {
    const k = `v-${r}-${c}`, a = lines[k];
    els.push(<div key={k} data-testid={`demo-${k}`} style={{
      position: 'absolute', left: c * (dot + seg) + (dot - thick) / 2, top: r * (dot + seg) + dot,
      width: thick, height: seg, borderRadius: thick / 2,
      backgroundColor: a ? pColor(a) : theme.emptyLineColor,
      opacity: a ? 1 : 0.2, transition: 'all .35s ease',
      boxShadow: a ? `0 0 8px ${pColor(a)}50` : 'none', zIndex: 1
    }} />);
  }

  // Boxes
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const owner = boxes[`${r}-${c}`];
    els.push(<div key={`b${r}${c}`} data-testid={`demo-box-${r}-${c}`} style={{
      position: 'absolute', left: c * (dot + seg) + dot, top: r * (dot + seg) + dot,
      width: seg, height: seg, borderRadius: 4,
      backgroundColor: owner ? pBox(owner) : 'transparent',
      transform: owner ? 'scale(1)' : 'scale(0)',
      transition: 'transform .4s cubic-bezier(.34,1.56,.64,1), background-color .3s',
      zIndex: 0
    }} />);
  }

  const youName = '👦 You';
  const alexName = '🤖 Alex';

  return (
    <div data-testid="game-demo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0' }}>
      {/* Turn / Result indicator */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', minHeight: 20, transition: 'all .3s' }}>
        {phase === 'result' ? (
          <span style={{ color: p1.lineColor, fontWeight: 700 }}>🏆 You win!</span>
        ) : (
          <span>
            <span style={{ color: pColor(currentPlayer), fontWeight: 700 }}>
              {currentPlayer === 1 ? youName : alexName}
            </span>
            {`'s turn`}
          </span>
        )}
      </div>

      {/* Grid */}
      <div style={{ position: 'relative', width: total, height: total, margin: '0 auto' }}>{els}</div>

      {/* Score */}
      <div data-testid="demo-score" style={{
        display: 'flex', alignItems: 'center', gap: 14, fontSize: 15, fontWeight: 700
      }}>
        <span style={{ color: p1.lineColor }}>{youName} {score[0]}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, opacity: 0.6 }}>vs</span>
        <span style={{ color: p2.lineColor }}>{alexName} {score[1]}</span>
      </div>
    </div>
  );
}
