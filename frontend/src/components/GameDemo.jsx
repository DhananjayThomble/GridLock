// src/components/GameDemo.jsx — Animated 2×2 dots-and-boxes demo for onboarding.
// Theme-aware, pure CSS transitions, scripted 4-move loop → capture → score → reset.
import React, { useEffect, useRef, useState } from 'react';
import { useGridTheme } from '../contexts/GridThemeContext';

const GRID = 2, DOTS = 3, LOOP_MS = 5000, BOX_DELAY = 2600;
const MOVES = [
  { delay: 0, type: 'h', row: 0, col: 0, player: 1 },
  { delay: 800, type: 'v', row: 0, col: 0, player: 2 },
  { delay: 1600, type: 'v', row: 0, col: 1, player: 1 },
  { delay: 2400, type: 'h', row: 1, col: 0, player: 1 },
];

export default function GameDemo() {
  const { theme } = useGridTheme();
  const [lines, setLines] = useState({});
  const [captured, setCaptured] = useState(false);
  const [score, setScore] = useState([0, 0]);
  const tRef = useRef([]);

  useEffect(() => {
    let off = false;
    const sched = (fn, ms) => { const t = setTimeout(fn, ms); tRef.current.push(t); };
    const cycle = () => {
      if (off) return;
      setLines({}); setCaptured(false); setScore([0, 0]);
      MOVES.forEach(({ delay, type, row, col, player }) =>
        sched(() => !off && setLines(p => ({ ...p, [`${type}-${row}-${col}`]: player })), delay));
      sched(() => { if (!off) { setCaptured(true); setScore([1, 0]); } }, BOX_DELAY);
    };
    cycle();
    const iv = setInterval(cycle, LOOP_MS);
    tRef.current.push(iv);
    return () => { off = true; tRef.current.forEach(id => { clearTimeout(id); clearInterval(id); }); tRef.current = []; };
  }, []);

  const { p1, p2 } = theme.players;
  const color = p => p === 1 ? p1.lineColor : p2.lineColor;
  const dot = Math.max(6, theme.visualDotSize);
  const seg = 40, thick = Math.max(4, Math.min(theme.lineThickness, 6));
  const total = DOTS * dot + GRID * seg;
  const tLine = 'background-color .3s,opacity .3s';
  const tBox = 'transform .3s,background-color .3s';
  const els = [];

  for (let r = 0; r < DOTS; r++) for (let c = 0; c < DOTS; c++) {
    const x = c * (dot + seg), y = r * (dot + seg);
    els.push(<div key={`d${r}${c}`} data-testid="demo-dot" style={{ position: 'absolute', left: x, top: y, width: dot, height: dot, backgroundColor: theme.dotColor, ...theme.dotStyle, zIndex: 2 }} />);
    if (c < GRID) { const k = `h-${r}-${c}`, a = lines[k]; els.push(<div key={k} data-testid={`demo-${k}`} className={a ? 'demo-line-active' : ''} style={{ position: 'absolute', left: x + dot, top: y + (dot - thick) / 2, width: seg, height: thick, backgroundColor: a ? color(a) : theme.emptyLineColor, opacity: a ? 1 : .25, transition: tLine, ...theme.lineStyle, zIndex: 1 }} />); }
    if (r < GRID) { const k = `v-${r}-${c}`, a = lines[k]; els.push(<div key={k} data-testid={`demo-${k}`} className={a ? 'demo-line-active' : ''} style={{ position: 'absolute', left: x + (dot - thick) / 2, top: y + dot, width: thick, height: seg, backgroundColor: a ? color(a) : theme.emptyLineColor, opacity: a ? 1 : .25, transition: tLine, ...theme.lineStyle, zIndex: 1 }} />); }
  }
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const cap = captured && r === 0 && c === 0;
    els.push(<div key={`b${r}${c}`} data-testid={`demo-box-${r}-${c}`} style={{ position: 'absolute', left: c * (dot + seg) + dot, top: r * (dot + seg) + dot, width: seg, height: seg, backgroundColor: cap ? p1.boxBg : 'transparent', transform: cap ? 'scale(1)' : 'scale(0)', transition: tBox, borderRadius: 2, zIndex: 0 }} />);
  }

  return (
    <div data-testid="game-demo" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0' }}>
      <div style={{ position: 'relative', width: total, height: total, margin: '0 auto' }}>{els}</div>
      <div data-testid="demo-score" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-secondary,#9ca3af)' }}>
        <span style={{ color: p1.lineColor }}>{score[0]}</span>
        <span style={{ opacity: .5 }}>–</span>
        <span style={{ color: p2.lineColor }}>{score[1]}</span>
      </div>
    </div>
  );
}
